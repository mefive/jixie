import { backtestReportStatusWhere } from '#strategy/backtests/state.js';
import { getDatabase } from '#infra/database/prisma.js';
import { JobService, ACTIVE_JOB_STATUSES } from '#jobs/job-service.js';
import type {
  BacktestSettings,
  BacktestReportDetail,
  BacktestReportSummary,
  BacktestSummary,
} from '@jixie/shared';
import { Prisma } from '@prisma/client';
import { StrategyError } from '../errors.js';
import { strategyResultSettings, strategyInputSignature } from '../definitions/config.js';
import type {
  StrategyBacktestIdentityQuery,
  StrategyBacktestJobQuery,
} from '@jixie/shared/api/strategy';

export async function findActiveStrategyBacktestJob(
  userId: string,
  query: StrategyBacktestIdentityQuery,
) {
  const job = await getDatabase().job.findFirst({
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
 * 按用户与策略归属列出保留回测结果，供最近结果查询。
 *
 * List the retained backtest result within user and strategy ownership.
 */
export async function listStrategyBacktestReports(
  userId: string,
  query: StrategyBacktestIdentityQuery,
) {
  const reports = await getDatabase().backtestReport.findMany({
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
      settings: true,
      payload: true,
      createdAt: true,
      computedAt: true,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 1,
  });

  return reports.map(backtestReportSummary);
}

/**
 * 校验报告访问归属并读取其结果及实际运行参数。
 *
 * Authorize access and read a report's results and actual run settings.
 */
export async function readStrategyBacktestReport(userId: string, reportId: string) {
  const report = await getDatabase().backtestReport.findFirst({
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
      settings: true,
      inputSignature: true,
      strategy: { select: { config: true } },
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
    settings: strategyResultSettings(report.settings),
    result: report.payload as unknown as BacktestSummary,
    needsRerun: report.inputSignature !== strategyInputSignature(report.strategy.config),
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
  const ownedJob = await getDatabase().job.findFirst({
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
  settings: unknown;
  payload: unknown;
  createdAt: Date;
  computedAt: Date | null;
}): BacktestReportSummary {
  const config: BacktestSettings = strategyResultSettings(report.settings);
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
