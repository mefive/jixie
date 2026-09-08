import { z } from 'zod';
import { prisma } from '../../infra/database/prisma.js';
import { getJob } from '../../infra/jobs/records.js';
import { getHoldoutPolicy, parseResearchIntent, researchCounts } from './research-policy.js';
import { holdoutEligibility } from './holdout-policy.js';
import { reportSummary, reportResearchSpec, parseResearchPayload } from './views.js';
import { t } from '../../i18n/index.js';
import type { Locale } from '@jixie/shared';
import { failFactorOperation } from '../operation-errors.js';

export const factorJobLogsQuerySchema = z.object({ since: z.string().regex(/^\d+$/).optional() });

export const factorReportListQuerySchema = z.object({
  factor: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

export async function listFactorReports(
  userId: string,
  input: z.infer<typeof factorReportListQuerySchema>,
) {
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
  input: z.infer<typeof factorJobLogsQuerySchema>,
  locale: Locale,
) {
  const job = await getJob(userId, jobId, Number(input.since ?? '0'));

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

export const factorResearchSummaryQuerySchema = z.object({ factor: z.string().min(1).optional() });

export async function readFactorResearchWindow(locale: Locale) {
  const policy = await getHoldoutPolicy();

  if (!policy) {
    return failFactorOperation('missing', t(locale, 'windowNotComputed'));
  }

  return policy;
}

export async function readFactorResearchSummary(
  userId: string,
  input: z.infer<typeof factorResearchSummaryQuerySchema>,
) {
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
