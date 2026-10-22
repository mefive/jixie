import { factorReportState } from '#factor/evaluations/state.js';
import { getDatabase } from '#infra/database/prisma.js';
import type { FactorReport } from '@jixie/shared';
import { FactorError } from '../errors.js';
import { readOwnedFactorJob } from '../jobs/read.js';
import type {
  FactorJobLogsQuery,
  FactorReportListQuery,
  FactorResearchSummaryQuery,
} from '@jixie/shared/api/factor';
import { holdoutEligibility } from './holdout-policy.js';
import { reportResearchSpec } from './report-spec.js';
import { parseResearchPayload, reportSummary } from './report-views.js';
import { getHoldoutPolicy, parseResearchIntent, researchCounts } from './research-policy.js';

/**
 * 按权限列出因子报告及运行状态，保留探索与保留段区别。
 *
 * List authorized factor reports and execution state with explicit explore and holdout scope.
 */
export async function listFactorReports(userId: string, input: FactorReportListQuery) {
  const { factor, limit, cursor } = input;
  const cursorReport = cursor
    ? await getDatabase().factorReport.findFirst({
        where: { id: cursor, userId, factor },
        select: { id: true, createdAt: true },
      })
    : null;
  const rows = await getDatabase()
    .factorReport.findMany({
      where: {
        userId,
        factor,
        ...(cursorReport
          ? {
              OR: [
                { createdAt: { lt: cursorReport.createdAt } },
                { createdAt: cursorReport.createdAt, id: { lt: cursorReport.id } },
              ],
            }
          : {}),
      },
      include: { job: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    })
    .then((rows) => rows.map(factorReportState));
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(reportSummary);

  return { items, nextCursor: hasMore ? items.at(-1)?.id : undefined };
}

/**
 * 校验报告归属与揭示状态后读取完整结果。
 *
 * Authorize a report and its reveal state before returning the full result.
 */
export async function readFactorReport(userId: string, reportId: string) {
  const row = await getDatabase()
    .factorReport.findFirst({
      where: { id: reportId, userId },
      include: { job: true },
    })
    .then((row) => (row ? factorReportState(row) : row));

  if (!row) {
    throw new FactorError('evaluation_not_found');
  }

  const summary = reportSummary(row);
  const researchSpec = reportResearchSpec(row);
  const sealed = row.phase === 'holdout' && row.revealedAt === null;
  const researchPayload = sealed ? undefined : parseResearchPayload(row.payload, researchSpec);
  const payload =
    researchPayload?.analysisKind === 'cross_sectional' ? researchPayload.report : undefined;

  return {
    ...summary,
    payload,
    researchPayload,
    factorCodeSnapshot: row.factorCodeSnapshot ?? undefined,
    factorCodeHash: row.factorCodeHash ?? undefined,
    dataRevision: row.dataRevision ?? undefined,
    parentReportId: row.parentReportId ?? undefined,
    researchIntent: parseResearchIntent(row.researchIntentJson),
    holdout: await holdoutEligibility(row),
    canReveal: row.phase === 'holdout' && row.status === 'done' && sealed,
  };
}

/**
 * 按归属读取因子分析任务与关联报告状态。
 *
 * Read an owned factor-analysis job and associated report state.
 */
export async function readFactorAnalysisJob(
  userId: string,
  jobId: string,
  input: FactorJobLogsQuery,
) {
  const job = await readOwnedFactorJob(
    userId,
    jobId,
    'factor-analysis',
    Number(input.since ?? '0'),
  );

  if (!job) {
    throw new FactorError('factor_job_not_found');
  }

  if (job.factorReportId) {
    const report = await getDatabase().factorReport.findFirst({
      where: { id: job.factorReportId, userId },
      select: { phase: true, revealedAt: true },
    });
    if (report?.phase === 'holdout' && !report.revealedAt) {
      return { ...job, logs: [] };
    }
  }

  return job;
}

export async function readFactorResearchWindow() {
  const policy = await getHoldoutPolicy();

  if (!policy) {
    throw new FactorError('evaluation_not_found');
  }

  return policy;
}

export async function readFactorResearchSummary(userId: string, input: FactorResearchSummaryQuery) {
  const { factor } = input;
  const rows = await getDatabase()
    .factorReport.findMany({
      where: { userId },
      select: {
        failureMessage: true,
        job: true,
        factor: true,
        phase: true,
        legacyStatus: true,
        testKey: true,
        revealedAt: true,
      },
    })
    .then((rows) => rows.map(factorReportState));

  return {
    global: researchCounts(rows),
    factor: factor ? researchCounts(rows.filter((row) => row.factor === factor)) : undefined,
  };
}

/**
 * 读取已完成且可见的分析结果，保留未完成与不可揭示状态。
 *
 * Read a completed visible analysis result while preserving pending and sealed states.
 */
export async function readFactorAnalysisResult(
  userId: string,
  reportId: string,
): Promise<{
  status: 'running' | 'done' | 'error' | 'stale';
  error?: string;
  payload?: FactorReport;
} | null> {
  const row = await getDatabase()
    .factorReport.findFirst({
      where: { id: reportId, userId, phase: 'explore' },
      select: { job: true, legacyStatus: true, failureMessage: true, payload: true },
    })
    .then((row) => (row ? factorReportState(row) : row));
  if (!row) {
    return null;
  }

  const status = ['running', 'done', 'error', 'stale'].includes(row.status)
    ? (row.status as 'running' | 'done' | 'error' | 'stale')
    : 'error';
  let payload: FactorReport | undefined;
  if (row.payload) {
    try {
      payload = JSON.parse(row.payload) as FactorReport;
    } catch {
      return { status: 'error', error: 'Factor report payload is invalid.' };
    }
  }
  return { status, error: row.error ?? undefined, payload };
}
