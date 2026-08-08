import { Worker } from 'node:worker_threads';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';
import type { FactorReport as FactorReportRow } from '@prisma/client';
import type {
  FactorCorrelation,
  FactorHoldoutEligibility,
  FactorReport as FactorAnalysisPayload,
  FactorReportStatus,
  FactorReportSummary,
  FactorResearchReportPayloadV1,
  FactorResearchSpecV1,
  FactorPanelReportV1,
  FactorTimeSeriesReportV1,
  LogLine,
  ChatMessage,
  RunFactorAnalysisResponse,
} from '@jixie/shared';
import { timeSeriesAggregateMetrics } from '@jixie/shared';
import { apiError, validateJson, validateQuery } from '../lib/httpError.js';
import { prisma } from '../lib/prisma.js';
import { BUILTIN_FACTORS, BUILTIN_KEYS } from '../factor/builtin-factors.js';
import { factorProfile } from '../agent/profiles/factor.js';
import { factorQaProfile } from '../agent/profiles/qa.js';
import { enqueueAgentTurn, entityKey } from '../agent/turn-run.js';
import * as turnBus from '../agent/turn-bus.js';
import { chatMessagesSchema } from '../lib/chat-schema.js';
import { createJob, appendLog, finishJob, getJob, findRunningJob } from '../lib/jobs.js';
import { localeFromRequest, m } from '../i18n/index.js';
import { refreshFactorMetadata } from '../factor/metadata.js';
import {
  factorAnalysisSpecSchema,
  factorCompositeDefinitionV1Schema,
  factorResearchIntentV1Schema,
  factorResearchSpecV1Schema,
  factorVariantKey,
  normalizeFactorAnalysisSpec,
  normalizeFactorResearchSpec,
} from '../factor/report-spec.js';
import {
  enoughHoldoutPeriods,
  getHoldoutPolicy,
  parseResearchIntent,
  researchCounts,
} from '../factor/research.js';
import {
  launchFactorWorker,
  parseFactorAnalysisSourceSnapshot,
  startFactorAnalysis,
  type FactorAnalysisSource,
} from '../factor/analysis-job.js';
import { resolveTimeSeriesTemplateSource } from '../factor/time-series-templates.js';
import { resolvePanelTemplateSource } from '../factor/panel-templates.js';

/**
 * Factor workbench actions (singular, mounted at /api/app/factor — product line 1.5 · factor research).
 * Resource CRUD (catalog / custom factors) lives in factors.ts (plural). Reports are per-user (a public
 * factor's analysis is still cached per user, not shared). Analysis is CPU/IO-heavy → runs in a worker
 * (factor-worker.ts) as a Job:
 *   POST /agent                              one turn of the factor Agent; POST /qa preset Q&A
 *   POST /metadata                           refresh mutable display metadata from code + conversation
 *   GET  /reports?factor                     this user's immutable report history for a factor
 *   GET  /reports/:reportId                  one owner-scoped report and its frozen inputs/result
 *   POST /analysis/run                       create a report + Job, then start the worker
 *   GET  /analysis/job/:id?since=             poll a Job: {status, logs, nextSince, error}
 *   /correlation…                            factor×factor cross-sectional Spearman (same Job shape)
 * Naming rules: see docs/design/api-route-naming.md.
 */
export const factorRoute = new Hono();

const correlationWorkerUrl = import.meta.url.endsWith('.ts')
  ? new URL('../factor/correlation-worker.boot.mjs', import.meta.url)
  : new URL('../factor/correlation-worker.js', import.meta.url);

// Correlation cache/job keys — factor keys are sorted so key order doesn't fork the cache.
const sortedKeys = (keys: string[]) => [...keys].sort();
const correlationId = (userId: string, keys: string[], freq: string, start: string, end: string) =>
  `${userId}|${sortedKeys(keys).join(',')}|${freq}|${start}|${end}`;
const correlationJobKey = (keys: string[], freq: string, start: string, end: string) =>
  `corr|${sortedKeys(keys).join(',')}|${freq}|${start}|${end}`;

// POST /agent — START one turn of the factor Agent (iterates on the defineFactor code) and return a
// turnId; the turn runs in the background (subscribe via GET /api/app/agent/turns/:id/stream).
// History comes from the factor row; the runner persists the user message + reply onto it.
const agentBody = z.object({
  id: z.string().min(1),
  message: z.string().trim().min(1).max(2000),
  code: z.string().min(1).max(20_000),
});

factorRoute.post('/agent', validateJson(agentBody), async (c) => {
  const { id, message, code } = c.req.valid('json');
  const userId = c.var.userId;
  const factor = await prisma.factor.findFirst({
    where: { id, userId },
    select: { id: true, analysisKind: true, status: true },
  });
  if (!factor) {
    return apiError(c, 'NOT_FOUND', m(c, 'factorNotFound'));
  }
  if (factor.status !== 'draft') {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'publishedFactorReadonly'));
  }
  const entity = { kind: 'factor' as const, id };
  if (turnBus.findRunning(entityKey(entity), userId)) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'factorTurnInProgress'));
  }

  const locale = localeFromRequest(c);
  const turnId = ulid();
  enqueueAgentTurn({
    turnId,
    userId,
    profile: factorProfile({
      userId,
      factorId: id,
      currentCode: code,
      locale,
      analysisKind:
        factor.analysisKind === 'time_series' || factor.analysisKind === 'panel'
          ? factor.analysisKind
          : 'cross_sectional',
    }),
    entity,
    message,
    currentCode: code,
    locale,
    afterTurn: async (result, messages) => {
      await refreshFactorMetadata({ factorId: id, userId, code: result.code, messages });
    },
  });
  return c.json({ turnId });
});

// POST /qa — Q&A about a PRESET factor (built-in, no code). Ephemeral: no host entity, history rides
// in the request and nothing persists — but the reply still streams (same turnId + SSE protocol).
const qaBody = z.object({
  history: chatMessagesSchema.default([]),
  message: z.string().trim().min(1).max(2000),
  factorName: z.string().max(80).optional(),
});

factorRoute.post('/qa', validateJson(qaBody), (c) => {
  const { history, message, factorName } = c.req.valid('json');
  const turnId = ulid();
  enqueueAgentTurn({
    turnId,
    userId: c.var.userId,
    profile: factorQaProfile(factorName),
    entity: null,
    history,
    message,
    currentCode: '',
    locale: localeFromRequest(c),
  });
  return c.json({ turnId });
});

const metadataBody = z.object({
  id: z.string().min(1),
  code: z.string().min(1).max(20_000),
});

factorRoute.post('/metadata', validateJson(metadataBody), async (c) => {
  const { id, code } = c.req.valid('json');
  const factor = await prisma.factor.findFirst({
    where: { id, userId: c.var.userId },
    select: { messages: true, status: true },
  });
  if (!factor) {
    return apiError(c, 'NOT_FOUND', m(c, 'factorNotFound'));
  }
  if (factor.status !== 'draft') {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'publishedFactorReadonly'));
  }
  try {
    await refreshFactorMetadata({
      factorId: id,
      userId: c.var.userId,
      code,
      messages: Array.isArray(factor.messages) ? (factor.messages as unknown as ChatMessage[]) : [],
    });
  } catch (error) {
    return apiError(
      c,
      'SERVICE_UNAVAILABLE',
      error instanceof Error ? error.message : m(c, 'nameFailed'),
    );
  }
  return c.json({ ok: true });
});

const sinceQuery = z.object({ since: z.string().regex(/^\d+$/).optional() });

const reportListQuery = z.object({
  factor: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

factorRoute.get('/reports', validateQuery(reportListQuery), async (c) => {
  const userId = c.var.userId;
  const { factor, limit, cursor } = c.req.valid('query');
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

  return c.json({ items, nextCursor: hasMore ? items.at(-1)?.id : undefined });
});

factorRoute.get('/reports/:reportId', async (c) => {
  const row = await prisma.factorReport.findFirst({
    where: { id: c.req.param('reportId'), userId: c.var.userId },
    include: { job: { select: { id: true } } },
  });
  if (!row) {
    return apiError(c, 'NOT_FOUND', m(c, 'windowNotComputed'));
  }
  const summary = reportSummary(row);
  const researchSpec = reportResearchSpec(row);
  const sealed = row.phase === 'holdout' && row.revealedAt === null;
  const researchPayload = sealed ? undefined : parseResearchPayload(row.payload, researchSpec);
  const payload =
    researchPayload?.analysisKind === 'cross_sectional' ? researchPayload.report : undefined;

  return c.json({
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
  });
});

factorRoute.get('/analysis/job/:jobId', validateQuery(sinceQuery), async (c) => {
  const job = await getJob(
    c.var.userId,
    c.req.param('jobId'),
    Number(c.req.valid('query').since ?? '0'),
  );
  if (!job) {
    return apiError(c, 'NOT_FOUND', m(c, 'factorJobNotFound'));
  }
  if (job.factorReportId) {
    const report = await prisma.factorReport.findFirst({
      where: { id: job.factorReportId, userId: c.var.userId },
      select: { phase: true, revealedAt: true },
    });
    if (report?.phase === 'holdout' && !report.revealedAt) {
      return c.json({ ...job, logs: [] });
    }
  }
  return c.json(job);
});

const researchSummaryQuery = z.object({ factor: z.string().min(1).optional() });

factorRoute.get('/research/window', async (c) => {
  const policy = await getHoldoutPolicy();
  if (!policy) {
    return apiError(c, 'NOT_FOUND', m(c, 'windowNotComputed'));
  }
  return c.json(policy);
});

factorRoute.get('/research/summary', validateQuery(researchSummaryQuery), async (c) => {
  const { factor } = c.req.valid('query');
  const rows = await prisma.factorReport.findMany({
    where: { userId: c.var.userId },
    select: { factor: true, phase: true, status: true, testKey: true, revealedAt: true },
  });

  return c.json({
    global: researchCounts(rows),
    factor: factor ? researchCounts(rows.filter((row) => row.factor === factor)) : undefined,
  });
});

const runAnalysisBody = z.object({
  factor: z.string().min(1),
  spec: z.union([factorAnalysisSpecSchema, factorResearchSpecV1Schema]),
  parentReportId: z.string().min(1).nullable().optional(),
  researchIntent: factorResearchIntentV1Schema,
});

factorRoute.post('/analysis/run', validateJson(runAnalysisBody), async (c) => {
  const userId = c.var.userId;
  const { factor, parentReportId, researchIntent } = c.req.valid('json');
  let researchSpec = normalizeFactorResearchSpec(c.req.valid('json').spec);
  if (!criterionMatchesAnalysisKind(researchSpec, researchIntent)) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'factorCriterionUnsupported'));
  }
  let source: FactorAnalysisSource | null;
  if (researchSpec.analysisKind === 'cross_sectional') {
    let protocol = researchSpec.protocol;
    source = await resolveFactorSource(userId, factor);
    if (!source) {
      return apiError(c, 'NOT_FOUND', m(c, 'unknownFactor', { factor }));
    }
    if (source.kind === 'composite') {
      if (protocol.version !== 4) {
        return apiError(c, 'VALIDATION_FAILED', m(c, 'windowNotComputed'));
      }
      protocol = { ...protocol, composite: source.definition };
    } else if (protocol.version === 4) {
      return apiError(c, 'VALIDATION_FAILED', m(c, 'windowNotComputed'));
    }
    researchSpec = { ...researchSpec, protocol };
  } else if (researchSpec.analysisKind === 'time_series') {
    source =
      resolveTimeSeriesTemplateSource(factor) ??
      (await resolveCustomTimeSeriesFactorSource(userId, factor));
    if (!source) {
      return apiError(c, 'NOT_FOUND', m(c, 'unknownFactor', { factor }));
    }
    const cutoffSpec = {
      ...researchSpec,
      dataPolicy: {
        ...researchSpec.dataPolicy,
        dataCutoff: researchSpec.dataPolicy.dataCutoff ?? researchSpec.end,
      },
    };
    const dataCutoff = await resolveEtfDataCutoff(cutoffSpec);
    if (!dataCutoff) {
      return apiError(c, 'VALIDATION_FAILED', m(c, 'windowNotComputed'));
    }
    researchSpec = {
      ...researchSpec,
      dataPolicy: { ...researchSpec.dataPolicy, dataCutoff },
    };
  } else if (researchSpec.analysisKind === 'panel') {
    source =
      resolvePanelTemplateSource(factor) ??
      (await resolveCustomAssetFactorSource(userId, factor, 'panel'));
    if (!source) {
      return apiError(c, 'NOT_FOUND', m(c, 'unknownFactor', { factor }));
    }
    const cutoffSpec = {
      ...researchSpec,
      dataPolicy: {
        ...researchSpec.dataPolicy,
        dataCutoff: researchSpec.dataPolicy.dataCutoff ?? researchSpec.end,
      },
    };
    const dataCutoff = await resolveEtfDataCutoff(cutoffSpec);
    if (!dataCutoff) {
      return apiError(c, 'VALIDATION_FAILED', m(c, 'windowNotComputed'));
    }
    researchSpec = {
      ...researchSpec,
      dataPolicy: { ...researchSpec.dataPolicy, dataCutoff },
    };
  } else {
    return apiError(
      c,
      'VALIDATION_FAILED',
      m(c, 'factorAnalysisKindUnsupported', { kind: researchSpec.analysisKind }),
    );
  }
  const researchWindow =
    researchSpec.analysisKind === 'cross_sectional' ? researchSpec.protocol : researchSpec;
  if (researchWindow.start >= researchWindow.end) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'startAfterEnd'));
  }
  if (parentReportId) {
    const parent = await prisma.factorReport.findFirst({
      where: { id: parentReportId, userId, factor },
      select: { id: true },
    });
    if (!parent) {
      return apiError(c, 'NOT_FOUND', m(c, 'windowNotComputed'));
    }
  }
  const response = await startFactorAnalysis({
    userId,
    factor,
    source,
    spec: researchSpec,
    researchIntent,
    parentReportId,
    locale: localeFromRequest(c),
    failedMessage: m(c, 'factorAnalysisFailed'),
    exitedMessage: (code) => m(c, 'factorProcExited', { code }),
  });
  return c.json(response);
});

factorRoute.post('/reports/:reportId/holdout', async (c) => {
  const userId = c.var.userId;
  const parent = await prisma.factorReport.findFirst({
    where: { id: c.req.param('reportId'), userId },
  });
  if (!parent) {
    return apiError(c, 'NOT_FOUND', m(c, 'windowNotComputed'));
  }
  const eligibility = await holdoutEligibility(parent);
  if (!eligibility.eligible) {
    if (eligibility.existingReportId) {
      const existing = await prisma.factorReport.findUnique({
        where: { id: eligibility.existingReportId },
        include: { job: { select: { id: true } } },
      });
      if (existing?.job) {
        return c.json({
          reportId: existing.id,
          jobId: existing.job.id,
          status: 'running',
          reusedRunning: true,
        } satisfies RunFactorAnalysisResponse);
      }
    }
    return apiError(c, 'VALIDATION_FAILED', m(c, 'windowNotComputed'), {
      reason: eligibility.reason,
    });
  }
  const policy = eligibility.window!;
  const parentResearchSpec = reportResearchSpec(parent);
  let researchSpec: FactorResearchSpecV1;
  if (parentResearchSpec.analysisKind === 'cross_sectional') {
    researchSpec = {
      version: 1,
      analysisKind: 'cross_sectional',
      protocol: normalizeFactorAnalysisSpec({
        ...parentResearchSpec.protocol,
        start: policy.holdoutStart,
        end: policy.holdoutEnd,
      }),
    };
  } else if (
    parentResearchSpec.analysisKind === 'time_series' ||
    parentResearchSpec.analysisKind === 'panel'
  ) {
    const candidate = {
      ...parentResearchSpec,
      start: policy.holdoutStart,
      end: policy.holdoutEnd,
      dataPolicy: { ...parentResearchSpec.dataPolicy, dataCutoff: policy.holdoutEnd },
    };
    const dataCutoff = await resolveEtfDataCutoff(candidate);
    if (!dataCutoff) {
      return apiError(c, 'VALIDATION_FAILED', m(c, 'windowNotComputed'));
    }
    researchSpec = {
      ...candidate,
      dataPolicy: { ...candidate.dataPolicy, dataCutoff },
    };
  } else {
    return apiError(
      c,
      'VALIDATION_FAILED',
      m(c, 'factorAnalysisKindUnsupported', { kind: parentResearchSpec.analysisKind }),
    );
  }
  const factorCodeSnapshot = parent.factorCodeSnapshot!;
  const factorCodeHash = parent.factorCodeHash!;
  const identitySpec =
    researchSpec.analysisKind === 'cross_sectional' ? researchSpec.protocol : researchSpec;
  const variantKey = factorVariantKey(identitySpec, factorCodeHash, parent.dataRevision);
  const columns = reportCompatibilityColumns(researchSpec);
  const reportId = ulid();
  const jobId = ulid();
  const created = await prisma.$transaction(async (transaction) => {
    const existing = await transaction.factorReport.findFirst({
      where: {
        userId,
        parentReportId: parent.id,
        phase: 'holdout',
        status: { in: ['running', 'done'] },
      },
      include: { job: { select: { id: true } } },
    });
    if (existing?.job) {
      return { reportId: existing.id, jobId: existing.job.id, reusedRunning: true };
    }
    await transaction.factorReport.create({
      data: {
        id: reportId,
        userId,
        factor: parent.factor,
        status: 'running',
        phase: 'holdout',
        ...columns,
        analysisKind: researchSpec.analysisKind,
        specJson: JSON.stringify(researchSpec),
        variantKey,
        factorCodeSnapshot,
        factorCodeHash,
        dataRevision: parent.dataRevision,
        parentReportId: parent.id,
        testKey: parent.testKey,
        researchIntentJson: parent.researchIntentJson,
        holdoutPolicyJson: JSON.stringify(policy),
        job: { create: { id: jobId, userId, kind: 'factor', key: variantKey, status: 'running' } },
      },
    });
    return { reportId, jobId, reusedRunning: false };
  });
  const response: RunFactorAnalysisResponse = { ...created, status: 'running' };
  if (!created.reusedRunning) {
    const source =
      researchSpec.analysisKind === 'time_series' || researchSpec.analysisKind === 'panel'
        ? ({
            kind: researchSpec.analysisKind,
            code: factorCodeSnapshot,
            label: parent.factor,
          } as const)
        : parseFactorAnalysisSourceSnapshot(
            factorCodeSnapshot,
            parseReportPayload(parent.payload)?.label ?? parent.factor,
            researchSpec.protocol.version === 4,
          );
    await launchFactorWorker({
      reportId,
      jobId,
      factor: parent.factor,
      source,
      spec: researchSpec,
      locale: localeFromRequest(c),
      failedMessage: m(c, 'factorAnalysisFailed'),
      exitedMessage: (code) => m(c, 'factorProcExited', { code }),
    });
  }
  return c.json(response);
});

factorRoute.post('/reports/:reportId/reveal', async (c) => {
  const reportId = c.req.param('reportId');
  const report = await prisma.factorReport.findFirst({
    where: { id: reportId, userId: c.var.userId, phase: 'holdout', status: 'done' },
  });
  if (!report) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'windowNotComputed'));
  }
  if (!report.revealedAt) {
    await prisma.factorReport.updateMany({
      where: { id: reportId, userId: c.var.userId, revealedAt: null },
      data: { revealedAt: new Date() },
    });
  }
  const revealed = await prisma.factorReport.findUniqueOrThrow({
    where: { id: reportId },
    include: { job: { select: { id: true } } },
  });
  const researchSpec = reportResearchSpec(revealed);
  const researchPayload = parseResearchPayload(revealed.payload, researchSpec);
  return c.json({
    ...reportSummary(revealed),
    payload:
      researchPayload?.analysisKind === 'cross_sectional' ? researchPayload.report : undefined,
    researchPayload,
    factorCodeSnapshot: revealed.factorCodeSnapshot ?? undefined,
    factorCodeHash: revealed.factorCodeHash ?? undefined,
    dataRevision: revealed.dataRevision ?? undefined,
    parentReportId: revealed.parentReportId ?? undefined,
    researchIntent: parseResearchIntent(revealed.researchIntentJson),
    canReveal: false,
  });
});

async function holdoutEligibility(row: FactorReportRow): Promise<FactorHoldoutEligibility> {
  if (row.phase !== 'explore') {
    return { eligible: false, reason: 'not_explore' };
  }
  if (row.status !== 'done') {
    return { eligible: false, reason: 'not_done' };
  }
  const intent = parseResearchIntent(row.researchIntentJson);
  if (
    !intent ||
    intent.mode !== 'hypothesis' ||
    intent.expectedDirection === 'unknown' ||
    !intent.primaryCriterion
  ) {
    return { eligible: false, reason: 'missing_hypothesis' };
  }
  const researchSpec = reportResearchSpec(row);
  const basePolicy = await getHoldoutPolicy();
  const policy =
    basePolicy &&
    (researchSpec.analysisKind === 'time_series' || researchSpec.analysisKind === 'panel')
      ? await capHoldoutPolicyAtEtfData(
          basePolicy,
          researchSpec.analysisKind === 'panel'
            ? researchSpec.assets.map((asset) => asset.assetId)
            : researchSpec.assets,
        )
      : basePolicy;
  if (!policy || row.end > policy.exploreEnd) {
    return { eligible: false, reason: 'outside_explore_window', window: policy ?? undefined };
  }
  const frequency =
    researchSpec.analysisKind === 'cross_sectional'
      ? researchSpec.protocol.freq
      : researchSpec.analysisKind === 'time_series'
        ? 'day'
        : researchSpec.analysisKind === 'panel'
          ? 'month'
          : null;
  if (!frequency || !enoughHoldoutPeriods(frequency, policy.holdoutStart, policy.holdoutEnd)) {
    return { eligible: false, reason: 'insufficient_periods', window: policy };
  }
  const existing = await prisma.factorReport.findFirst({
    where: {
      userId: row.userId,
      parentReportId: row.id,
      phase: 'holdout',
      status: { in: ['running', 'done'] },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (existing) {
    return {
      eligible: false,
      reason: 'already_exists',
      existingReportId: existing.id,
      window: policy,
    };
  }
  const observed = row.factorCodeHash
    ? await prisma.factorReport.findFirst({
        where: {
          userId: row.userId,
          id: { not: row.id },
          factorCodeHash: row.factorCodeHash,
          status: 'done',
          end: { gt: policy.exploreEnd },
        },
        select: { id: true },
      })
    : null;
  if (observed) {
    return { eligible: false, reason: 'already_observed', window: policy };
  }

  return { eligible: true, window: policy };
}

function reportSummary(
  row: FactorReportRow & { job?: { id: string } | null },
): FactorReportSummary {
  const sealed = row.phase === 'holdout' && row.revealedAt === null;
  const researchSpec = reportResearchSpec(row);
  const researchPayload = sealed ? undefined : parseResearchPayload(row.payload, researchSpec);
  const crossSectionalPayload =
    researchPayload?.analysisKind === 'cross_sectional' ? researchPayload.report : undefined;
  const timeSeriesMetrics =
    researchPayload?.analysisKind === 'time_series'
      ? timeSeriesAggregateMetrics(researchPayload.report)
      : undefined;
  const panelMetrics =
    researchPayload?.analysisKind === 'panel'
      ? {
          panelRankIcMean: researchPayload.report.rankIcMean,
          panelNetLongShortAnnualized: researchPayload.report.longShortNetAnnualized,
        }
      : undefined;

  return {
    id: row.id,
    factor: row.factor,
    analysisKind: researchSpec.analysisKind,
    status: reportStatus(row.status),
    phase: row.phase === 'explore' || row.phase === 'holdout' ? row.phase : 'legacy',
    spec: researchSpec.analysisKind === 'cross_sectional' ? researchSpec.protocol : undefined,
    researchSpec,
    variantKey: row.variantKey ?? undefined,
    jobId: row.job?.id,
    createdAt: row.createdAt.toISOString(),
    computedAt: row.computedAt?.toISOString(),
    error: row.error ?? undefined,
    sealed,
    revealedAt: row.revealedAt?.toISOString(),
    researchIntent: parseResearchIntent(row.researchIntentJson),
    metrics: crossSectionalPayload
      ? { rankIc: crossSectionalPayload.icMean }
      : timeSeriesMetrics
        ? timeSeriesMetrics
        : panelMetrics
          ? panelMetrics
          : undefined,
  };
}

function reportResearchSpec(row: FactorReportRow) {
  if (row.specJson) {
    try {
      return normalizeFactorResearchSpec(JSON.parse(row.specJson));
    } catch {
      // Legacy rows still have queryable parameter columns as a safe fallback.
    }
  }

  return normalizeFactorResearchSpec({
    version: 1,
    freq: row.freq === 'week' ? 'week' : 'month',
    start: row.start,
    end: row.end,
    neutral: row.neutral === 'size' || row.neutral === 'size_industry' ? row.neutral : 'none',
  });
}

function reportStatus(status: string): FactorReportStatus {
  switch (status) {
    case 'running':
    case 'error':
    case 'stale':
      return status;
    default:
      return 'done';
  }
}

function parseReportPayload(payload: string | null): FactorAnalysisPayload | undefined {
  if (!payload) {
    return undefined;
  }
  try {
    return JSON.parse(payload) as FactorAnalysisPayload;
  } catch {
    return undefined;
  }
}

function parseResearchPayload(
  payload: string | null,
  researchSpec: FactorResearchSpecV1,
): FactorResearchReportPayloadV1 | undefined {
  if (!payload) {
    return undefined;
  }
  try {
    const report = JSON.parse(payload) as unknown;
    switch (researchSpec.analysisKind) {
      case 'cross_sectional':
        return {
          version: 1,
          analysisKind: 'cross_sectional',
          report: report as FactorAnalysisPayload,
        };
      case 'time_series':
        return {
          version: 1,
          analysisKind: 'time_series',
          report: report as FactorTimeSeriesReportV1,
        };
      case 'panel':
        return {
          version: 1,
          analysisKind: 'panel',
          report: report as FactorPanelReportV1,
        };
      case 'macro_regime':
        return undefined;
    }
  } catch {
    return undefined;
  }
}

async function resolveEtfDataCutoff(
  researchSpec: Extract<FactorResearchSpecV1, { analysisKind: 'time_series' | 'panel' }>,
): Promise<string | null> {
  const availableCutoff = await resolveEtfCommonLatest(
    researchSpec.analysisKind === 'panel'
      ? researchSpec.assets.map((asset) => asset.assetId)
      : researchSpec.assets,
  );
  if (!availableCutoff) {
    return null;
  }
  const requestedCutoff = researchSpec.dataPolicy.dataCutoff;
  if (requestedCutoff && requestedCutoff > availableCutoff) {
    return null;
  }
  return requestedCutoff ?? availableCutoff;
}

async function resolveEtfCommonLatest(assets: string[]): Promise<string | null> {
  const latestRows = await prisma.etfDaily.groupBy({
    by: ['tsCode'],
    where: { tsCode: { in: assets }, close: { not: null } },
    _max: { tradeDate: true },
  });
  if (latestRows.length !== assets.length) {
    return null;
  }
  return (
    latestRows
      .map((row) => row._max.tradeDate)
      .filter((tradeDate): tradeDate is string => tradeDate !== null)
      .sort()[0] ?? null
  );
}

async function capHoldoutPolicyAtEtfData(
  policy: NonNullable<Awaited<ReturnType<typeof getHoldoutPolicy>>>,
  assets: string[],
) {
  const latestDate = await resolveEtfCommonLatest(assets);
  if (!latestDate || latestDate < policy.holdoutStart) {
    return null;
  }
  return {
    ...policy,
    latestDate,
    holdoutEnd: latestDate < policy.holdoutEnd ? latestDate : policy.holdoutEnd,
    checkedAt: new Date().toISOString(),
  };
}

function criterionMatchesAnalysisKind(
  spec: FactorResearchSpecV1,
  intent: NonNullable<FactorReportSummary['researchIntent']>,
): boolean {
  const metric = intent.primaryCriterion?.metric;
  if (!metric) {
    return true;
  }
  const metricKind = metric.startsWith('time_series_')
    ? 'time_series'
    : metric.startsWith('panel_')
      ? 'panel'
      : 'cross_sectional';
  return spec.analysisKind === metricKind;
}

function reportCompatibilityColumns(spec: FactorResearchSpecV1) {
  if (spec.analysisKind === 'cross_sectional') {
    return {
      freq: spec.protocol.freq,
      neutral: spec.protocol.neutral,
      start: spec.protocol.start,
      end: spec.protocol.end,
    };
  }
  const frequency = { daily: 'day', weekly: 'week', monthly: 'month' } as const;
  return {
    freq: frequency[spec.observationFrequency],
    neutral: 'none',
    start: spec.start,
    end: spec.end,
  };
}

async function resolveFactorSource(
  userId: string,
  factorId: string,
): Promise<FactorAnalysisSource | null> {
  const builtin = BUILTIN_FACTORS.find((factor) => factor.key === factorId);
  if (builtin) {
    return { kind: 'single', code: builtin.code, label: builtin.label };
  }
  const custom = await prisma.factor.findFirst({
    where: { id: factorId, userId },
    select: { code: true, name: true, analysisKind: true },
  });

  if (custom && custom.analysisKind !== 'time_series' && custom.analysisKind !== 'panel') {
    return { kind: 'single', code: custom.code, label: custom.name };
  }
  const composite = await prisma.factorComposite.findFirst({
    where: { id: factorId, userId },
    select: { name: true, definition: true },
  });
  if (!composite) {
    return null;
  }
  const definition = factorCompositeDefinitionV1Schema.parse(composite.definition);
  const components: Extract<FactorAnalysisSource, { kind: 'composite' }>['components'] = [];
  for (const component of definition.components) {
    const source = await resolveFactorSource(userId, component.factor);
    if (!source || source.kind !== 'single') {
      return null;
    }
    components.push({
      factor: component.factor,
      code: source.code,
      label: source.label,
      direction: component.direction,
    });
  }
  return {
    kind: 'composite',
    label: composite.name,
    definition,
    components,
  };
}

async function resolveCustomTimeSeriesFactorSource(
  userId: string,
  factorId: string,
): Promise<FactorAnalysisSource | null> {
  const custom = await prisma.factor.findFirst({
    where: { id: factorId, userId, analysisKind: 'time_series' },
    select: { code: true, name: true },
  });
  return custom ? { kind: 'time_series', code: custom.code, label: custom.name } : null;
}

async function resolveCustomAssetFactorSource<TAnalysisKind extends 'time_series' | 'panel'>(
  userId: string,
  factorId: string,
  analysisKind: TAnalysisKind,
): Promise<Extract<FactorAnalysisSource, { kind: TAnalysisKind }> | null> {
  const custom = await prisma.factor.findFirst({
    where: { id: factorId, userId, analysisKind },
    select: { code: true, name: true },
  });
  return custom
    ? ({ kind: analysisKind, code: custom.code, label: custom.name } as Extract<
        FactorAnalysisSource,
        { kind: TAnalysisKind }
      >)
    : null;
}

// —— Correlation matrix (3.4): 2–8 factors × a fixed size column, cross-sectional Spearman ——

const correlationQuery = z.object({
  keys: z.string().min(1), // comma-separated factor keys
  freq: z.enum(['month', 'week']).default('month'),
  start: z
    .string()
    .regex(/^\d{8}$/)
    .default('20150101'),
  end: z
    .string()
    .regex(/^\d{8}$/)
    .default('20261231'),
  refresh: z.string().optional(),
});

// Parse + validate the keys list: 2–8 distinct factors, each a preset slug or one of this user's own.
async function resolveCorrelationKeys(
  userId: string,
  raw: string,
): Promise<{ keys: string[] } | { error: string }> {
  const keys = [
    ...new Set(
      raw
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
    ),
  ];
  if (keys.length < 2 || keys.length > 8) {
    return { error: 'correlationKeyCount' };
  }
  for (const key of keys) {
    if (BUILTIN_KEYS.has(key)) {
      continue;
    }
    const custom = await prisma.factor.findFirst({
      where: { id: key, userId },
      select: { id: true },
    });
    if (!custom) {
      return { error: key };
    }
  }
  return { keys };
}

factorRoute.get('/correlation', validateQuery(correlationQuery), async (c) => {
  const userId = c.var.userId;
  const { keys, freq, start, end } = c.req.valid('query');
  const resolved = await resolveCorrelationKeys(userId, keys);
  if ('error' in resolved) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'windowNotComputed'));
  }
  const cached = await prisma.factorCorrelation.findUnique({
    where: { id: correlationId(userId, resolved.keys, freq, start, end) },
  });
  if (!cached) {
    return apiError(c, 'NOT_FOUND', m(c, 'windowNotComputed'));
  }
  return c.json(JSON.parse(cached.payload) as FactorCorrelation);
});

factorRoute.get('/correlation/running', validateQuery(correlationQuery), async (c) => {
  const { keys, freq, start, end } = c.req.valid('query');
  const resolved = await resolveCorrelationKeys(c.var.userId, keys);
  if ('error' in resolved) {
    return c.json({ jobId: null });
  }
  const jobId = await findRunningJob(
    c.var.userId,
    'factor',
    correlationJobKey(resolved.keys, freq, start, end),
  );
  return c.json({ jobId });
});

factorRoute.post('/correlation/run', validateQuery(correlationQuery), async (c) => {
  const userId = c.var.userId;
  const { keys, freq, start, end, refresh } = c.req.valid('query');
  const resolved = await resolveCorrelationKeys(userId, keys);
  if ('error' in resolved) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'unknownFactor', { factor: resolved.error }));
  }
  if (start >= end) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'startAfterEnd'));
  }
  const id = correlationId(userId, resolved.keys, freq, start, end);

  if (refresh !== '1') {
    const cached = await prisma.factorCorrelation.findUnique({ where: { id } });
    if (cached) {
      return c.json({ done: true, report: JSON.parse(cached.payload) as FactorCorrelation });
    }
  }
  const existing = await findRunningJob(
    userId,
    'factor',
    correlationJobKey(resolved.keys, freq, start, end),
  );
  if (existing) {
    return c.json({ jobId: existing });
  }

  const jobId = await createJob(
    userId,
    'factor',
    correlationJobKey(resolved.keys, freq, start, end),
  );
  const worker = new Worker(correlationWorkerUrl, {
    workerData: { id, userId, keys: resolved.keys, freq, start, end, locale: localeFromRequest(c) },
  });
  let finished = false;
  const done = (status: 'done' | 'error', error?: string) => {
    if (finished) {
      return;
    }
    finished = true;
    void finishJob(jobId, status, error);
  };
  worker.on('message', (msg: { type: string; entry?: LogLine; message?: string }) => {
    if (msg.type === 'log') {
      appendLog(jobId, msg.entry!);
    } else if (msg.type === 'done') {
      done('done');
    } else if (msg.type === 'error') {
      done('error', msg.message);
    }
  });
  worker.on('error', (err) => done('error', err.message));
  worker.on('exit', (code) => {
    if (code !== 0) {
      done('error', m(c, 'factorProcExited', { code }));
    }
  });
  return c.json({ jobId });
});
