import { backtestReportStatusWhere } from '#strategy/backtests/state.js';
import { prisma } from '#infra/database/prisma.js';
import { JobService, ACTIVE_JOB_STATUSES } from '#jobs/job-service.js';
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

/**
 * 按用户与策略归属列出冻结回测报告，供历史结果选择。
 *
 * List frozen backtest reports within user and strategy ownership.
 */
export async function listStrategyBacktestReports(
  userId: string,
  query: StrategyBacktestIdentityQuery,
) {
  const reports = await prisma.backtestReport.findMany({
    where: {
      userId: userId,
      strategyId: query.strategyId,
      AND: [backtestReportStatusWhere(['done'])],
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

/**
 * 校验报告访问归属并读取其冻结结果及配置。
 *
 * Authorize access and read a report's frozen results and configuration.
 */
export async function readStrategyBacktestReport(userId: string, reportId: string) {
  const report = await prisma.backtestReport.findFirst({
    where: {
      id: reportId,
      userId: userId,
      AND: [backtestReportStatusWhere(['done'])],
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

/**
 * 验证回测任务归属及报告关联后返回进度。
 *
 * Authorize a backtest job and report association before returning progress.
 */
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

  const job = await JobService.get(userId, ownedJob.id, Number(query.since ?? '0'));

  if (!job) {
    throw new StrategyError('backtest_job_not_found');
  }

  return job;
}

/**
 * 提取回测报告的关键绩效与身份，供列表及研究目录展示。
 *
 * Extract report identity and headline performance for lists and research catalogs.
 */
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
