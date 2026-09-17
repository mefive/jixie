import { t } from '#i18n/index.js';
import { prisma } from '#infra/database/prisma.js';
import type { FactorReport, Locale } from '@jixie/shared';
import { failFactorOperation } from '../errors.js';
import { readOwnedFactorJob } from '../jobs/read.js';
import type {
  FactorReportListQuery,
  FactorJobLogsQuery,
  FactorResearchSummaryQuery,
} from '../schema.js';
import { holdoutEligibility } from './holdout-policy.js';
import { parseResearchPayload, reportSummary } from './report-views.js';
import { reportResearchSpec } from './report-spec.js';
import { getHoldoutPolicy, parseResearchIntent, researchCounts } from './research-policy.js';

export async function listFactorReports(userId: string, input: FactorReportListQuery) {
  const { factor, limit, cursor } = input;
  const cursorReport = cursor
    ? await prisma.factorReport.findFirst({
        where: { id: cursor, userId, factor },
        select: { id: true, createdAt: true },
      })
    : null;
  const rows = await prisma.factorReport.findMany({
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
    include: { job: { select: { id: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(reportSummary);

  return { items, nextCursor: hasMore ? items.at(-1)?.id : undefined };
}

export async function readFactorReport(userId: string, reportId: string, locale: Locale) {
  const row = await prisma.factorReport.findFirst({
    where: { id: reportId, userId },
    include: { job: { select: { id: true } } },
  });

  if (!row) {
    return failFactorOperation('missing', t(locale, 'windowNotComputed'));
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

export async function readFactorAnalysisJob(
  userId: string,
  jobId: string,
  input: FactorJobLogsQuery,
  locale: Locale,
) {
  const job = await readOwnedFactorJob(
    userId,
    jobId,
    'factor-analysis',
    Number(input.since ?? '0'),
  );

  if (!job) {
    return failFactorOperation('missing', t(locale, 'factorJobNotFound'));
  }

  if (job.factorReportId) {
    const report = await prisma.factorReport.findFirst({
      where: { id: job.factorReportId, userId },
      select: { phase: true, revealedAt: true },
    });
    if (report?.phase === 'holdout' && !report.revealedAt) {
      return { ...job, logs: [] };
    }
  }

  return job;
}

export async function readFactorResearchWindow(locale: Locale) {
  const policy = await getHoldoutPolicy();

  if (!policy) {
    return failFactorOperation('missing', t(locale, 'windowNotComputed'));
  }

  return policy;
}

export async function readFactorResearchSummary(userId: string, input: FactorResearchSummaryQuery) {
  const { factor } = input;
  const rows = await prisma.factorReport.findMany({
    where: { userId },
    select: { factor: true, phase: true, status: true, testKey: true, revealedAt: true },
  });

  return {
    global: researchCounts(rows),
    factor: factor ? researchCounts(rows.filter((row) => row.factor === factor)) : undefined,
  };
}

export async function readFactorAnalysisResult(
  userId: string,
  reportId: string,
): Promise<{
  status: 'running' | 'done' | 'error' | 'stale';
  error?: string;
  payload?: FactorReport;
} | null> {
  const row = await prisma.factorReport.findFirst({
    where: { id: reportId, userId, phase: 'explore' },
    select: { status: true, error: true, payload: true },
  });
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
