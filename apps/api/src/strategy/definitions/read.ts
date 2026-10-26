import type { Prisma } from '@prisma/client';
import { strategyInputSignature } from './config.js';
import { backtestReportState } from '../backtests/state.js';
import { getDatabase } from '#infra/database/prisma.js';
import { readCodeProposalHistory } from '#agent/conversations/code-proposals.js';
import { type BacktestSummary, type StrategyCard } from '@jixie/shared';
import { StrategyError } from '../errors.js';

export async function listStrategies(userId: string) {
  const rows = await getDatabase().strategy.findMany({
    where: { userId: userId },
    select: {
      id: true,
      name: true,
      createdAt: true,
      updatedAt: true,
      backtestReports: {
        take: 1,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: { job: { select: { status: true, error: true } } },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });
  const cards: StrategyCard[] = rows.map((strategy) => ({
    id: strategy.id,
    name: strategy.name,
    createdAt: strategy.createdAt.toISOString(),
    updatedAt: strategy.updatedAt.toISOString(),
    snapshot: strategyCardSnapshot(
      latestBacktest(strategy.backtestReports[0], undefined).lastResult,
    ),
  }));

  return cards;
}

function strategyCardSnapshot(lastResult: unknown): StrategyCard['snapshot'] {
  const result = lastResult as BacktestSummary | null;

  if (!result || !Array.isArray(result.nav) || result.nav.length === 0) {
    return undefined;
  }

  const values = result.nav.map((point) => point.value);
  const maximumPoints = 48;
  const step = Math.max(1, Math.floor(values.length / maximumPoints));
  const spark = values.filter((_, index) => index % step === 0);

  return { totalReturn: result.totalReturn, sharpe: result.sharpe, trades: result.trades, spark };
}

/**
 * 按用户归属读取策略及配置，并整理当前运行信息。
 *
 * Read an owned strategy, its configuration and current execution information.
 */
export async function readStrategy(userId: string, strategyId: string) {
  const row = await getDatabase().strategy.findFirst({
    where: { id: strategyId, userId: userId },
    include: {
      backtestReports: {
        take: 1,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: { job: { select: { status: true, error: true } } },
      },
    },
  });

  if (!row) {
    throw new StrategyError('strategy_not_found');
  }

  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    config: row.config,
    ...latestBacktest(row.backtestReports[0], row.config),
    messages: Array.isArray(row.messages)
      ? await readCodeProposalHistory(getDatabase(), userId, 'strategy', strategyId, row.messages)
      : row.messages,
  };
}

/**
 * 最近提交失败或仍在运行时不回退旧结果；当前代码只用于过期检测。
 *
 * Never fall back to an older result after a pending or failed submission; current code only detects staleness.
 */
function latestBacktest(
  row:
    | {
        id: string;
        inputSignature: string | null;
        payload: Prisma.JsonValue | null;
        legacyStatus: string | null;
        legacyError: string | null;
        job: { status: string; error: string | null } | null;
      }
    | undefined,
  config: unknown,
) {
  if (!row) {
    return { lastResult: null, lastBacktest: null };
  }

  const state = backtestReportState(row);

  return {
    lastResult: state.status === 'done' ? (row.payload as unknown as BacktestSummary) : null,
    lastBacktest: {
      id: row.id,
      status: state.status,
      needsRerun: row.inputSignature !== strategyInputSignature(config),
      error: state.error,
    },
  };
}
