import { prisma } from '#infra/database/prisma.js';
import { ACTIVE_JOB_STATUSES, getJob } from '#infra/jobs/records.js';
import type {
  BacktestConfig,
  BacktestReportDetail,
  BacktestReportSummary,
  BacktestSummary,
} from '@jixie/shared';
import { Prisma } from '@prisma/client';
import { StrategyError } from '../errors.js';
import type {
  StrategyBacktestIdentityQuery,
  StrategyBacktestJobQuery,
} from '@jixie/shared/api/strategy';

export async function findActiveStrategyBacktestJob(
  userId: string,
  query: StrategyBacktestIdentityQuery,
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
  query: StrategyBacktestIdentityQuery,
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

export async function readStrategyBacktestReport(userId: string, reportId: string) {
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
    throw new StrategyError('backtest_report_not_found');
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
  query: StrategyBacktestJobQuery,
) {
  const ownedJob = await prisma.job.findFirst({
    where: { id: jobId, userId, kind: 'backtest' },
    select: { id: true },
  });

  if (!ownedJob) {
    throw new StrategyError('backtest_job_not_found');
  }

  const job = await getJob(userId, ownedJob.id, Number(query.since ?? '0'));

  if (!job) {
    throw new StrategyError('backtest_job_not_found');
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
