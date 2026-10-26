import pkg from '@prisma/client';
import type { Prisma, Job } from '@prisma/client';
import { strategyInputSignature, strategyResultSettings } from '../definitions/config.js';

const { Prisma: PrismaValues } = pkg;
interface StrategyResultScope {
  userId: string;
  strategyId: string;
}
interface ResultRow {
  id: string;
  userId: string;
  strategyId: string;
  job: { status: string } | null;
}

/**
 * 每个用户／策略保留最近回测、最近扫描与活动任务，并清除终态任务输入。
 *
 * Keep each user's latest backtest and scan per strategy plus active jobs; clear terminal inputs.
 */
export async function pruneStrategyResults(
  transaction: Prisma.TransactionClient,
  scope?: StrategyResultScope,
) {
  const backtests = await transaction.backtestReport.findMany({
    where: scope,
    select: {
      id: true,
      userId: true,
      strategyId: true,
      settings: true,
      job: { select: { status: true } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  const obsoleteBacktests = obsoleteIds(backtests);
  for (let offset = 0; offset < obsoleteBacktests.length; offset += 128) {
    await transaction.backtestReport.deleteMany({
      where: { id: { in: obsoleteBacktests.slice(offset, offset + 128) } },
    });
  }

  for (const row of backtests) {
    if (obsoleteBacktests.includes(row.id) || !hasSource(row.settings)) {
      continue;
    }

    await transaction.backtestReport.update({
      where: { id: row.id },
      data: {
        settings: strategyResultSettings(row.settings) as unknown as Prisma.InputJsonValue,
        inputSignature: strategyInputSignature(row.settings),
      },
    });
  }

  const scans = await transaction.strategyScanReport.findMany({
    where: scope,
    select: {
      id: true,
      userId: true,
      strategyId: true,
      settings: true,
      updatedAt: true,
      job: { select: { status: true } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  const obsoleteScans = obsoleteIds(scans);
  for (let offset = 0; offset < obsoleteScans.length; offset += 128) {
    await transaction.strategyScanReport.deleteMany({
      where: { id: { in: obsoleteScans.slice(offset, offset + 128) } },
    });
  }

  for (const row of scans) {
    if (obsoleteScans.includes(row.id) || !hasSource(row.settings)) {
      continue;
    }

    await transaction.strategyScanReport.update({
      where: { id: row.id },
      data: {
        settings: strategyResultSettings(row.settings) as unknown as Prisma.InputJsonValue,
        inputSignature: strategyInputSignature(row.settings),
        updatedAt: row.updatedAt,
      },
    });
  }

  await transaction.job.updateMany({
    where: {
      OR: [
        { kind: { in: ['backtest', 'strategy-scan'] } },
        { backtestReportId: { not: null } },
        { strategyScanReportId: { not: null } },
      ],
      status: { notIn: ['queued', 'running'] },
      payload: { not: PrismaValues.DbNull },
      ...(scope ? { userId: scope.userId, key: scope.strategyId } : {}),
    },
    data: { payload: PrismaValues.DbNull },
  });
}

/**
 * 通过关联生命周期收尾，即使任务 kind 损坏也清除其临时输入。
 *
 * Clear temporary input through the linked lifecycle even if job kind metadata is corrupt.
 */
export async function finishStrategyJob(transaction: Prisma.TransactionClient, job: Job) {
  await transaction.job.updateMany({
    where: { id: job.id, userId: job.userId },
    data: { payload: PrismaValues.DbNull },
  });
  await pruneStrategyResults(transaction, { userId: job.userId, strategyId: job.key });
}

function obsoleteIds(rows: ResultRow[]) {
  const latest = new Map<string, Set<string>>();
  const obsolete: string[] = [];

  for (const row of rows) {
    const strategies = latest.get(row.userId) ?? new Set<string>();
    const first = !strategies.has(row.strategyId);
    strategies.add(row.strategyId);
    latest.set(row.userId, strategies);

    if (!first && !['queued', 'running'].includes(row.job?.status ?? '')) {
      obsolete.push(row.id);
    }
  }

  return obsolete;
}

function hasSource(value: unknown): boolean {
  return !!value && typeof value === 'object' && 'code' in value;
}
