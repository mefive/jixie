import { factorReportState } from '#factor/evaluations/state.js';
import { getDatabase } from '#infra/database/prisma.js';
import type { FactorReport } from '@jixie/shared';
import { FactorError } from '../errors.js';
import { readOwnedFactorJob } from '../jobs/read.js';
import type { FactorJobLogsQuery, FactorReportListQuery } from '@jixie/shared/api/factor';
import { reportResearchSpec } from './report-spec.js';
import { parseResearchPayload, reportSummary } from './report-views.js';

/**
 * 按权限列出因子报告及运行状态，保留用户选择的参数。
 *
 * List authorized factor reports and execution state with their selected parameters.
 */
export async function listFactorReports(userId: string, input: FactorReportListQuery) {
  const rows = await getDatabase().factorReport.findMany({
    where: { userId, factor: input.factor },
    include: { job: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });

  return { items: rows.map(factorReportState).map(reportSummary) };
}

/**
 * 校验报告归属后读取完整结果。
 *
 * Authorize a report before returning the full result.
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
  const researchPayload = parseResearchPayload(row.payload, researchSpec);
  const payload =
    researchPayload?.analysisKind === 'cross_sectional' ? researchPayload.report : undefined;

  return {
    ...summary,
    payload,
    researchPayload,
    factorCodeSnapshot: row.factorCodeSnapshot ?? undefined,
    factorCodeHash: row.factorCodeHash ?? undefined,
    dataRevision: row.dataRevision ?? undefined,
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

  return job;
}

/**
 * 读取已完成且可见的分析结果，保留未完成状态。
 *
 * Read a completed visible analysis result while preserving pending states.
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
      where: { id: reportId, userId },
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
