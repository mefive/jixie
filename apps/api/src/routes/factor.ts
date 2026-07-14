import { Worker } from 'node:worker_threads';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';
import type { FactorReport as FactorReportRow } from '@prisma/client';
import type {
  FactorAnalysisSpecV1,
  FactorCorrelation,
  FactorReport as FactorAnalysisPayload,
  FactorReportStatus,
  FactorReportSummary,
  LogLine,
  ChatMessage,
  RunFactorAnalysisResponse,
} from '@jixie/shared';
import { apiError, validateJson, validateQuery } from '../lib/httpError.js';
import { prisma } from '../lib/prisma.js';
import { BUILTIN_FACTORS, BUILTIN_KEYS } from '../factor/builtin-factors.js';
import { factorProfile } from '../agent/profiles/factor.js';
import { factorQaProfile } from '../agent/profiles/qa.js';
import { enqueueAgentTurn, entityKey } from '../agent/turn-run.js';
import * as turnBus from '../agent/turn-bus.js';
import { chatMessagesSchema } from '../lib/chat-schema.js';
import {
  createJob,
  appendLog,
  finishJob,
  finishFactorReportJob,
  getJob,
  findRunningJob,
  initializeJobLogs,
} from '../lib/jobs.js';
import { localeFromRequest, m } from '../i18n/index.js';
import { refreshFactorMetadata } from '../factor/metadata.js';
import {
  factorAnalysisSpecV1Schema,
  factorVariantKey,
  normalizeFactorAnalysisSpec,
  sha256,
} from '../factor/report-spec.js';

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

// Worker entry: dev (tsx) spawns the .mjs bootstrap; prod spawns the compiled .js.
const workerUrl = import.meta.url.endsWith('.ts')
  ? new URL('../factor/factor-worker.boot.mjs', import.meta.url)
  : new URL('../factor/factor-worker.js', import.meta.url);
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
  const factor = await prisma.factor.findFirst({ where: { id, userId }, select: { id: true } });
  if (!factor) {
    return apiError(c, 'NOT_FOUND', m(c, 'factorNotFound'));
  }
  const entity = { kind: 'factor' as const, id };
  if (turnBus.findRunning(entityKey(entity), userId)) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'factorTurnInProgress'));
  }

  const turnId = ulid();
  enqueueAgentTurn({
    turnId,
    userId,
    profile: factorProfile(),
    entity,
    message,
    currentCode: code,
    locale: localeFromRequest(c),
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
    select: { messages: true },
  });
  if (!factor) {
    return apiError(c, 'NOT_FOUND', m(c, 'factorNotFound'));
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

  return c.json({
    ...summary,
    payload: parseReportPayload(row.payload),
    factorCodeSnapshot: row.factorCodeSnapshot ?? undefined,
    factorCodeHash: row.factorCodeHash ?? undefined,
    dataRevision: row.dataRevision ?? undefined,
    parentReportId: row.parentReportId ?? undefined,
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
  return c.json(job);
});

const runAnalysisBody = z.object({
  factor: z.string().min(1),
  spec: factorAnalysisSpecV1Schema,
  parentReportId: z.string().min(1).nullable().optional(),
});

factorRoute.post('/analysis/run', validateJson(runAnalysisBody), async (c) => {
  const userId = c.var.userId;
  const { factor, parentReportId } = c.req.valid('json');
  const spec = normalizeFactorAnalysisSpec(c.req.valid('json').spec);
  const source = await resolveFactorSource(userId, factor);
  if (!source) {
    return apiError(c, 'NOT_FOUND', m(c, 'unknownFactor', { factor }));
  }
  if (spec.start >= spec.end) {
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
  const factorCodeHash = sha256(source.code);
  const dataRevision = null;
  const variantKey = factorVariantKey(spec, factorCodeHash, dataRevision);
  const reportId = ulid();
  const jobId = ulid();
  const created = await prisma.$transaction(async (transaction) => {
    const running = await transaction.factorReport.findFirst({
      where: { userId, factor, variantKey, status: 'running' },
      include: { job: { select: { id: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    });
    if (running?.job?.status === 'running') {
      return { reportId: running.id, jobId: running.job.id, reusedRunning: true };
    }
    if (running) {
      await transaction.factorReport.update({
        where: { id: running.id },
        data: { status: 'stale' },
      });
    }

    await transaction.factorReport.create({
      data: {
        id: reportId,
        userId,
        factor,
        status: 'running',
        phase: 'explore',
        freq: spec.freq,
        neutral: spec.neutral,
        start: spec.start,
        end: spec.end,
        specJson: JSON.stringify(spec),
        variantKey,
        factorCodeSnapshot: source.code,
        factorCodeHash,
        dataRevision,
        parentReportId: parentReportId ?? null,
        job: {
          create: {
            id: jobId,
            userId,
            kind: 'factor',
            key: variantKey,
            status: 'running',
          },
        },
      },
    });

    return { reportId, jobId, reusedRunning: false };
  });
  const response: RunFactorAnalysisResponse = { ...created, status: 'running' };
  if (created.reusedRunning) {
    return c.json(response);
  }

  initializeJobLogs(jobId);
  const locale = localeFromRequest(c);
  let worker: Worker;
  try {
    worker = new Worker(workerUrl, {
      workerData: {
        reportId,
        factor,
        factorCodeSnapshot: source.code,
        factorLabel: source.label,
        freq: spec.freq,
        start: spec.start,
        end: spec.end,
        neutral: spec.neutral,
        locale,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishFactorReportJob(
      jobId,
      reportId,
      'error',
      undefined,
      message,
      m(c, 'factorAnalysisFailed'),
    );
    return c.json(response);
  }
  let finished = false;
  const done = (status: 'done' | 'error', payload?: string, error?: string) => {
    if (finished) {
      return;
    }
    finished = true;
    void finishFactorReportJob(
      jobId,
      reportId,
      status,
      payload,
      error,
      status === 'error' ? m(c, 'factorAnalysisFailed') : undefined,
    ).catch((finishError) => {
      console.error('[jixie] failed to finalize factor report', finishError);
    });
  };
  worker.on(
    'message',
    (message: { type: string; entry?: LogLine; message?: string; payload?: string }) => {
      if (message.type === 'log') {
        appendLog(jobId, message.entry!);
      } else if (message.type === 'done') {
        done('done', message.payload);
      } else if (message.type === 'error') {
        done('error', undefined, message.message);
      }
    },
  );
  worker.on('error', (error) => done('error', undefined, error.message));
  worker.on('exit', (code) => {
    if (code !== 0) {
      done('error', undefined, m(c, 'factorProcExited', { code }));
    }
  });
  return c.json(response);
});

function reportSummary(
  row: FactorReportRow & { job?: { id: string } | null },
): FactorReportSummary {
  const payload = parseReportPayload(row.payload);

  return {
    id: row.id,
    factor: row.factor,
    status: reportStatus(row.status),
    phase: row.phase === 'explore' ? 'explore' : 'legacy',
    spec: reportSpec(row),
    variantKey: row.variantKey ?? undefined,
    jobId: row.job?.id,
    createdAt: row.createdAt.toISOString(),
    computedAt: row.computedAt?.toISOString(),
    error: row.error ?? undefined,
    metrics: payload ? { rankIc: payload.icMean } : undefined,
  };
}

function reportSpec(row: FactorReportRow): FactorAnalysisSpecV1 {
  if (row.specJson) {
    try {
      return normalizeFactorAnalysisSpec(JSON.parse(row.specJson));
    } catch {
      // Legacy rows still have queryable parameter columns as a safe fallback.
    }
  }

  return {
    version: 1,
    freq: row.freq === 'week' ? 'week' : 'month',
    start: row.start,
    end: row.end,
    neutral: row.neutral === 'size' || row.neutral === 'size_industry' ? row.neutral : 'none',
  };
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

async function resolveFactorSource(
  userId: string,
  factorId: string,
): Promise<{ code: string; label: string } | null> {
  const builtin = BUILTIN_FACTORS.find((factor) => factor.key === factorId);
  if (builtin) {
    return { code: builtin.code, label: builtin.label };
  }
  const custom = await prisma.factor.findFirst({
    where: { id: factorId, userId },
    select: { code: true, name: true },
  });

  return custom ? { code: custom.code, label: custom.name } : null;
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
