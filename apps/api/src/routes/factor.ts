import { Worker } from 'node:worker_threads';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';
import type { FactorReport, FactorCorrelation, LogLine, ChatMessage } from '@jixie/shared';
import { apiError, validateJson, validateQuery } from '../lib/httpError.js';
import { prisma } from '../lib/prisma.js';
import { BUILTIN_KEYS } from '../factor/builtin-factors.js';
import { factorProfile } from '../agent/profiles/factor.js';
import { factorQaProfile } from '../agent/profiles/qa.js';
import { enqueueAgentTurn, entityKey } from '../agent/turn-run.js';
import * as turnBus from '../agent/turn-bus.js';
import { chatMessagesSchema } from '../lib/chat-schema.js';
import { createJob, appendLog, finishJob, getJob, findRunningJob } from '../lib/jobs.js';
import { localeFromRequest, m } from '../i18n/index.js';
import { refreshFactorMetadata } from '../factor/metadata.js';

/**
 * Factor workbench actions (singular, mounted at /api/app/factor — product line 1.5 · factor research).
 * Resource CRUD (catalog / custom factors) lives in factors.ts (plural). Reports are per-user (a public
 * factor's analysis is still cached per user, not shared). Analysis is CPU/IO-heavy → runs in a worker
 * (factor-worker.ts) as a Job:
 *   POST /agent                              one turn of the factor Agent; POST /qa preset Q&A
 *   POST /metadata                           refresh mutable display metadata from code + conversation
 *   GET  /runs?factor                        this user's cached runs of a factor (the "already run" chips)
 *   GET  /analysis?factor&freq&start&end      this user's cached report (404 if not computed yet)
 *   POST /analysis/run?...&refresh            cache hit → {done,report}; else start a Job → {jobId}
 *   GET  /analysis/job/:id?since=             poll a Job: {status, logs, nextSince, error}
 *   GET  /analysis/running?factor&freq&start&end   a still-running Job's id (re-attach after a refresh)
 *   /correlation…                            factor×factor cross-sectional Spearman (same Job shape)
 * Naming rules: see docs/design/api-route-naming.md.
 */
export const factorRoute = new Hono();

// 'none' keeps the pre-3.4 id shape so existing cached reports still resolve; other modes append a segment.
const reportId = (
  userId: string,
  factor: string,
  freq: string,
  start: string,
  end: string,
  neutral: string,
) =>
  neutral === 'none'
    ? `${userId}|${factor}|${freq}|${start}|${end}`
    : `${userId}|${factor}|${freq}|${start}|${end}|${neutral}`;
const jobKey = (factor: string, freq: string, start: string, end: string, neutral: string) =>
  neutral === 'none'
    ? `${factor}|${freq}|${start}|${end}`
    : `${factor}|${freq}|${start}|${end}|${neutral}`;

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

const analysisQuery = z.object({
  factor: z.string().min(1),
  freq: z.enum(['month', 'week']).default('month'),
  start: z
    .string()
    .regex(/^\d{8}$/)
    .default('20150101'),
  end: z
    .string()
    .regex(/^\d{8}$/)
    .default('20261231'),
  neutral: z.enum(['none', 'size', 'size_industry']).default('none'),
  refresh: z.string().optional(),
});
const sinceQuery = z.object({ since: z.string().regex(/^\d+$/).optional() });

factorRoute.get('/runs', validateQuery(z.object({ factor: z.string().min(1) })), async (c) => {
  const rows = await prisma.factorReport.findMany({
    where: { userId: c.var.userId, factor: c.req.valid('query').factor },
    select: { freq: true, neutral: true, start: true, end: true, computedAt: true },
    orderBy: { computedAt: 'desc' },
  });
  return c.json(rows);
});

// Clear this user's cached runs (all, or just one factor's) — lets a user discard stale reports, and
// keeps e2e runs isolated. Only ever touches the caller's own FactorReport rows.
factorRoute.delete(
  '/runs',
  validateQuery(z.object({ factor: z.string().min(1).optional() })),
  async (c) => {
    const { factor } = c.req.valid('query');
    const { count } = await prisma.factorReport.deleteMany({
      where: { userId: c.var.userId, ...(factor ? { factor } : {}) },
    });
    return c.json({ deleted: count });
  },
);

factorRoute.get('/analysis', validateQuery(analysisQuery), async (c) => {
  const { factor, freq, start, end, neutral } = c.req.valid('query');
  const cached = await prisma.factorReport.findUnique({
    where: { id: reportId(c.var.userId, factor, freq, start, end, neutral) },
  });
  if (!cached) {
    return apiError(c, 'NOT_FOUND', m(c, 'windowNotComputed'));
  }
  return c.json(JSON.parse(cached.payload) as FactorReport);
});

factorRoute.get('/analysis/running', validateQuery(analysisQuery), async (c) => {
  const { factor, freq, start, end, neutral } = c.req.valid('query');
  const jobId = await findRunningJob(
    c.var.userId,
    'factor',
    jobKey(factor, freq, start, end, neutral),
  );
  return c.json({ jobId });
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

factorRoute.post('/analysis/run', validateQuery(analysisQuery), async (c) => {
  const userId = c.var.userId;
  const { factor, freq, start, end, neutral, refresh } = c.req.valid('query');
  if (!BUILTIN_KEYS.has(factor)) {
    // Not a preset slug → must be one of this user's custom factors (id).
    const custom = await prisma.factor.findFirst({
      where: { id: factor, userId },
      select: { id: true },
    });
    if (!custom) {
      return apiError(c, 'NOT_FOUND', m(c, 'unknownFactor', { factor }));
    }
  }
  if (start >= end) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'startAfterEnd'));
  }

  if (refresh !== '1') {
    const cached = await prisma.factorReport.findUnique({
      where: { id: reportId(userId, factor, freq, start, end, neutral) },
    });
    if (cached) {
      return c.json({ done: true, report: JSON.parse(cached.payload) as FactorReport });
    }
  }
  // Dedupe: re-attach to an in-flight job for the same analysis instead of spawning a duplicate worker.
  const existing = await findRunningJob(
    userId,
    'factor',
    jobKey(factor, freq, start, end, neutral),
  );
  if (existing) {
    return c.json({ jobId: existing });
  }

  const jobId = await createJob(userId, 'factor', jobKey(factor, freq, start, end, neutral));
  const worker = new Worker(workerUrl, {
    workerData: { userId, factor, freq, start, end, neutral, locale: localeFromRequest(c) },
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
