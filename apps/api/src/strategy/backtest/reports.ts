import type { z } from 'zod';
import type {
  BacktestConfig,
  BacktestReportDetail,
  BacktestReportSummary,
  BacktestSummary,
} from '@jixie/shared';
import { Prisma } from '@prisma/client';
import { getJob, ACTIVE_JOB_STATUSES } from '#infra/jobs/records.js';
import { prisma } from '#infra/database/prisma.js';
import type { backtestStrategyIdentitySchema, backtestJobQuerySchema } from './inputs.js';
import { t } from '#i18n/index.js';
import type { Locale } from '@jixie/shared';
import { failStrategyOperation } from '../operation-errors.js';

export async function findActiveStrategyBacktestJob(
  userId: string,
  query: z.infer<typeof backtestStrategyIdentitySchema>,
) {
  const job = await prisma.job.findFirst({
    where: {
      userId,
      kind: 'backtest',
      key: query.strategyId,
      status: { in: ACTIVE_JOB_STATUSES },
      backtestReport: { userId, strategyId: query.strategyId },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, backtestReportId: true },
  });

  return job?.backtestReportId ? { jobId: job.id, reportId: job.backtestReportId } : null;
}

export async function listStrategyBacktestReports(
  userId: string,
  query: z.infer<typeof backtestStrategyIdentitySchema>,
) {
  const reports = await prisma.backtestReport.findMany({
    where: {
      userId: userId,
      strategyId: query.strategyId,
      status: 'done',
      payload: { not: Prisma.DbNull },
    },
    select: {
      id: true,
      strategyId: true,
      strategyName: true,
      config: true,
      payload: true,
      createdAt: true,
      computedAt: true,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });

  return reports.map(backtestReportSummary);
}

export async function readStrategyBacktestReport(userId: string, reportId: string, locale: Locale) {
  const report = await prisma.backtestReport.findFirst({
    where: {
      id: reportId,
      userId: userId,
      status: 'done',
      payload: { not: Prisma.DbNull },
    },
    select: {
      id: true,
      strategyId: true,
      strategyName: true,
      config: true,
      codeHash: true,
      resultHash: true,
      payload: true,
      createdAt: true,
      computedAt: true,
    },
  });

  if (!report) {
    return failStrategyOperation('missing', t(locale, 'backtestReportNotFound'));
  }

  const summary = backtestReportSummary(report);
  const detail: BacktestReportDetail = {
    ...summary,
    config: report.config as unknown as BacktestConfig,
    result: report.payload as unknown as BacktestSummary,
    codeHash: report.codeHash,
    resultHash: report.resultHash,
  };

  return detail;
}

export async function readStrategyBacktestJob(
  userId: string,
  jobId: string,
  query: z.infer<typeof backtestJobQuerySchema>,
  locale: Locale,
) {
  const ownedJob = await prisma.job.findFirst({
    where: { id: jobId, userId, kind: 'backtest' },
    select: { id: true },
  });

  if (!ownedJob) {
    return failStrategyOperation('missing', t(locale, 'backtestJobNotFound'));
  }

  const job = await getJob(userId, ownedJob.id, Number(query.since ?? '0'));

  if (!job) {
    return failStrategyOperation('missing', t(locale, 'backtestJobNotFound'));
  }

  return job;
}

function backtestReportSummary(report: {
  id: string;
  strategyId: string;
  strategyName: string;
  config: unknown;
  payload: unknown;
  createdAt: Date;
  computedAt: Date | null;
}): BacktestReportSummary {
  const config = report.config as BacktestConfig;
  const result = report.payload as BacktestSummary;

  return {
    id: report.id,
    strategyId: report.strategyId,
    strategyName: report.strategyName,
    status: 'done',
    start: config.start,
    end: config.end,
    language: config.language ?? 'typescript',
    totalReturn: result.totalReturn,
    annReturn: result.annReturn,
    sharpe: result.sharpe,
    maxDrawdown: result.maxDrawdown,
    trades: result.trades,
    createdAt: report.createdAt.toISOString(),
    computedAt: report.computedAt?.toISOString() ?? null,
  };
}
