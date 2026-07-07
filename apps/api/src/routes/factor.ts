import { Worker } from 'node:worker_threads';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import type { FactorReport, LogLine } from '@jixie/shared';
import { apiError, validateJson, validateQuery } from '../lib/httpError.js';
import { prisma } from '../lib/prisma.js';
import { chatText } from '../llm/deepseek.js';
import { BUILTIN_KEYS, BUILTIN_USER_ID, builtinCatalog } from '../factor/builtin-factors.js';
import { compileFactor } from '../factor/compile-factor.js';
import { factorProfile } from '../agent/profiles/factor.js';
import { factorQaProfile } from '../agent/profiles/qa.js';
import { enqueueAgentTurn, entityKey } from '../agent/turn-run.js';
import * as turnBus from '../agent/turn-bus.js';
import { chatMessagesSchema } from '../lib/chat-schema.js';
import { createJob, appendLog, finishJob, getJob, findRunningJob } from '../lib/jobs.js';
import { localeFromRequest, m } from '../i18n/index.js';

/**
 * Factor-analysis API (product line 1.5 · factor research). Reports are per-user (a public factor's analysis is still
 * cached per user, not shared). Analysis is CPU/IO-heavy → runs in a worker (factor-worker.ts) as a Job:
 *   GET  /catalog                            the factor list (identity + kind)
 *   GET  /runs?factor                        this user's cached runs of a factor (the "already run" chips)
 *   GET  /analysis?factor&freq&start&end      this user's cached report (404 if not computed yet)
 *   POST /analysis/run?...&refresh            cache hit → {done,report}; else start a Job → {jobId}
 *   GET  /analysis/job/:id?since=             poll a Job: {status, logs, nextSince, error}
 *   GET  /analysis/running?factor&freq&start&end   a still-running Job's id (re-attach after a refresh)
 */
export const factorRoute = new Hono();

const reportId = (userId: string, factor: string, freq: string, start: string, end: string) =>
  `${userId}|${factor}|${freq}|${start}|${end}`;
const jobKey = (factor: string, freq: string, start: string, end: string) =>
  `${factor}|${freq}|${start}|${end}`;

// Worker entry: dev (tsx) spawns the .mjs bootstrap; prod spawns the compiled .js.
const workerUrl = import.meta.url.endsWith('.ts')
  ? new URL('../factor/factor-worker.boot.mjs', import.meta.url)
  : new URL('../factor/factor-worker.js', import.meta.url);

factorRoute.get('/catalog', async (c) => {
  // Preset factors (registry identity; code lives on their seeded rows) + this user's custom factors.
  const custom = await prisma.factor.findMany({
    where: { userId: c.var.userId },
    select: { id: true, name: true },
    orderBy: { updatedAt: 'desc' },
  });
  const customMeta = custom.map((f) => ({ key: f.id, label: f.name, kind: 'custom' as const }));
  return c.json([...builtinCatalog(), ...customMeta]);
});

// —— Custom factors (code-first, Agent-authored — mirrors the strategy workbench) —— created on the
// first Agent prompt, then updated by id: messages in real time, code/name on an analysis run.

/** Make an LLM-suggested factor name unique within the user (append " N"). */
async function uniqueFactorName(userId: string, base: string): Promise<string> {
  for (let suffix = 1; suffix <= 50; suffix++) {
    const name = suffix === 1 ? base : `${base} ${suffix}`;
    const taken = await prisma.factor.findUnique({
      where: { userId_name: { userId, name } },
      select: { id: true },
    });
    if (!taken) {
      return name;
    }
  }
  return `${base} ${ulid().slice(-4)}`;
}

factorRoute.get('/custom', async (c) => {
  const rows = await prisma.factor.findMany({
    where: { userId: c.var.userId },
    select: { id: true, name: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  });
  return c.json(rows);
});

factorRoute.get('/custom/:id', async (c) => {
  // Own factors are editable; builtin (preset) rows are readable by anyone — the UI shows their
  // code read-only with a "copy as custom" affordance.
  const row = await prisma.factor.findFirst({
    where: { id: c.req.param('id'), userId: { in: [c.var.userId, BUILTIN_USER_ID] } },
    select: { id: true, name: true, code: true, messages: true, userId: true },
  });
  if (!row) {
    return apiError(c, 'NOT_FOUND', m(c, 'factorNotFound'));
  }
  const { userId: ownerId, ...rest } = row;
  return c.json({ ...rest, builtin: ownerId === BUILTIN_USER_ID });
});

// POST /custom — create a NEW factor row (up front on the first Agent prompt). The conversation rides
// along as optional `messages`; the code is compile-checked before persisting.
const createBody = z.object({
  name: z.string().min(1).max(40),
  code: z.string().min(1),
  messages: chatMessagesSchema.optional(),
});

factorRoute.post('/custom', validateJson(createBody), async (c) => {
  const userId = c.var.userId;
  const { name, code, messages } = c.req.valid('json');
  try {
    (await compileFactor(code)).dispose(); // validate-only
  } catch (e) {
    return apiError(
      c,
      'VALIDATION_FAILED',
      e instanceof Error ? e.message : m(c, 'factorCodeInvalid'),
    );
  }
  const uniqueName = await uniqueFactorName(userId, name);
  const id = ulid();
  await prisma.factor.create({
    data: {
      id,
      userId,
      name: uniqueName,
      code,
      ...(messages !== undefined ? { messages: messages as Prisma.InputJsonValue } : {}),
    },
  });
  return c.json({ id, name: uniqueName });
});

// POST /custom/:id — update by id. `{ messages }` alone = real-time chat save (code/name untouched);
// `{ code, name }` = an analysis run's commit (compile-check, drop the now-stale cached reports, rename
// unless it collides). Either may be present.
const updateBody = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1).max(40).optional(),
  messages: chatMessagesSchema.optional(),
});

factorRoute.post('/custom/:id', validateJson(updateBody), async (c) => {
  const id = c.req.param('id');
  const userId = c.var.userId;
  const { code, name, messages } = c.req.valid('json');
  if (BUILTIN_KEYS.has(id)) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'presetFactorReadonlyEdit'));
  }
  const existing = await prisma.factor.findFirst({
    where: { id, userId },
    select: { name: true, code: true },
  });
  if (!existing) {
    return apiError(c, 'NOT_FOUND', m(c, 'factorNotFound'));
  }

  const data: Prisma.FactorUpdateInput = {};
  if (messages !== undefined) {
    data.messages = messages as Prisma.InputJsonValue;
  }
  if (code !== undefined) {
    try {
      (await compileFactor(code)).dispose(); // validate-only
    } catch (e) {
      return apiError(
        c,
        'VALIDATION_FAILED',
        e instanceof Error ? e.message : m(c, 'factorCodeInvalid'),
      );
    }
    data.code = code;
    if (code !== existing.code) {
      // The factor values changed → its cached analysis reports are stale.
      await prisma.factorReport.deleteMany({ where: { userId, factor: id } });
    }
  }
  if (name !== undefined && name !== existing.name) {
    const taken = await prisma.factor.findUnique({
      where: { userId_name: { userId, name } },
      select: { id: true },
    });
    data.name = taken && taken.id !== id ? existing.name : name; // collision → keep current
  }

  const row = await prisma.factor.update({
    where: { id },
    data,
    select: { id: true, name: true },
  });
  return c.json(row);
});

factorRoute.delete('/custom/:id', async (c) => {
  const userId = c.var.userId;
  const id = c.req.param('id');
  if (BUILTIN_KEYS.has(id)) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'presetFactorReadonlyDelete'));
  }
  await prisma.factor.deleteMany({ where: { id, userId } });
  await prisma.factorReport.deleteMany({ where: { userId, factor: id } });
  return c.json({ ok: true });
});

// POST /custom/:id/fork — copy a factor's code (a builtin preset or one of your own) into a NEW
// editable custom factor — the "tweak params to spawn a variant" research path (factor-to-strategy.md path 2).
factorRoute.post('/custom/:id/fork', async (c) => {
  const userId = c.var.userId;
  const source = await prisma.factor.findFirst({
    where: { id: c.req.param('id'), userId: { in: [userId, BUILTIN_USER_ID] } },
    select: { name: true, code: true },
  });
  if (!source) {
    return apiError(c, 'NOT_FOUND', m(c, 'factorNotFound'));
  }

  const name = await uniqueFactorName(userId, `${source.name} ${m(c, 'copySuffix')}`.slice(0, 40));
  const id = ulid();
  await prisma.factor.create({ data: { id, userId, name, code: source.code } });
  return c.json({ id, name });
});

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

// POST /name — propose a short factor name. `{prompt}` names a brand-new factor from its request;
// `{code, currentName}` names from the code, keeping currentName when it still fits (on each run).
const nameBody = z
  .object({
    code: z.string().max(20_000).optional(),
    prompt: z.string().max(2000).optional(),
    currentName: z.string().max(40).optional(),
  })
  .refine((body) => body.code || body.prompt, { message: 'code or prompt required' });

factorRoute.post('/name', validateJson(nameBody), async (c) => {
  const { code, prompt, currentName } = c.req.valid('json');

  // The generated name is user-facing, so its language follows the request locale.
  const nameLangHint =
    localeFromRequest(c) === 'en'
      ? 'a short English name (≤5 words)'
      : 'a short Chinese name (≤12 chars)';

  let name: string;
  try {
    const system =
      code != null
        ? currentName
          ? `You name A-share factors. Read the factor code; it is currently called "${currentName}". If that name still accurately summarizes the code's logic, **return it unchanged**; only when the logic has clearly drifted, propose a more fitting ${nameLangHint}. Output only the name itself — no quotes, no explanation, no trailing punctuation.`
          : `You name A-share factors. Read the factor code and propose ${nameLangHint} summarizing its computation. Output only the name itself — no quotes, no explanation, no trailing punctuation.`
        : `You name A-share factors. Read the user's natural-language factor request and propose ${nameLangHint}. Output only the name itself — no quotes, no explanation, no trailing punctuation.`;
    const raw = await chatText([
      { role: 'system', content: system },
      { role: 'user', content: code ?? prompt! },
    ]);
    name = raw
      .trim()
      .replace(/^["'「『]+|["'」』。.]+$/g, '')
      .slice(0, 16);
  } catch (e) {
    return apiError(c, 'SERVICE_UNAVAILABLE', e instanceof Error ? e.message : m(c, 'nameFailed'));
  }
  return c.json({ name: name || m(c, 'unnamedFactor') });
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
  refresh: z.string().optional(),
});
const sinceQuery = z.object({ since: z.string().regex(/^\d+$/).optional() });

factorRoute.get('/runs', validateQuery(z.object({ factor: z.string().min(1) })), async (c) => {
  const rows = await prisma.factorReport.findMany({
    where: { userId: c.var.userId, factor: c.req.valid('query').factor },
    select: { freq: true, start: true, end: true, computedAt: true },
    orderBy: { computedAt: 'desc' },
  });
  return c.json(rows);
});

factorRoute.get('/analysis', validateQuery(analysisQuery), async (c) => {
  const { factor, freq, start, end } = c.req.valid('query');
  const cached = await prisma.factorReport.findUnique({
    where: { id: reportId(c.var.userId, factor, freq, start, end) },
  });
  if (!cached) {
    return apiError(c, 'NOT_FOUND', m(c, 'windowNotComputed'));
  }
  return c.json(JSON.parse(cached.payload) as FactorReport);
});

factorRoute.get('/analysis/running', validateQuery(analysisQuery), async (c) => {
  const { factor, freq, start, end } = c.req.valid('query');
  const jobId = await findRunningJob(c.var.userId, 'factor', jobKey(factor, freq, start, end));
  return c.json({ jobId });
});

factorRoute.get('/analysis/job/:jobId', validateQuery(sinceQuery), async (c) => {
  const job = await getJob(c.req.param('jobId'), Number(c.req.valid('query').since ?? '0'));
  if (!job) {
    return apiError(c, 'NOT_FOUND', m(c, 'factorJobNotFound'));
  }
  return c.json(job);
});

factorRoute.post('/analysis/run', validateQuery(analysisQuery), async (c) => {
  const userId = c.var.userId;
  const { factor, freq, start, end, refresh } = c.req.valid('query');
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
      where: { id: reportId(userId, factor, freq, start, end) },
    });
    if (cached) {
      return c.json({ done: true, report: JSON.parse(cached.payload) as FactorReport });
    }
  }
  // Dedupe: re-attach to an in-flight job for the same analysis instead of spawning a duplicate worker.
  const existing = await findRunningJob(userId, 'factor', jobKey(factor, freq, start, end));
  if (existing) {
    return c.json({ jobId: existing });
  }

  const jobId = await createJob(userId, 'factor', jobKey(factor, freq, start, end));
  const worker = new Worker(workerUrl, { workerData: { userId, factor, freq, start, end } });
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
