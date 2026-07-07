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

/**
 * Factor-analysis API (产品线 1.5 · 因子研究). Reports are per-user (a public factor's analysis is still
 * cached per user, not shared). Analysis is CPU/IO-heavy → runs in a worker (factor-worker.ts) as a Job:
 *   GET  /catalog                            the factor list (identity + kind)
 *   GET  /runs?factor                        this user's cached runs of a factor (the "已跑" chips)
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
  // code read-only with a "复制为自定义" affordance.
  const row = await prisma.factor.findFirst({
    where: { id: c.req.param('id'), userId: { in: [c.var.userId, BUILTIN_USER_ID] } },
    select: { id: true, name: true, code: true, messages: true, userId: true },
  });
  if (!row) {
    return apiError(c, 'NOT_FOUND', '因子不存在');
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
    return apiError(c, 'VALIDATION_FAILED', e instanceof Error ? e.message : '因子代码无效');
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
    return apiError(c, 'VALIDATION_FAILED', '预置因子只读,不能修改;可「复制为自定义」后改副本');
  }
  const existing = await prisma.factor.findFirst({
    where: { id, userId },
    select: { name: true, code: true },
  });
  if (!existing) {
    return apiError(c, 'NOT_FOUND', '因子不存在');
  }

  const data: Prisma.FactorUpdateInput = {};
  if (messages !== undefined) {
    data.messages = messages as Prisma.InputJsonValue;
  }
  if (code !== undefined) {
    try {
      (await compileFactor(code)).dispose(); // validate-only
    } catch (e) {
      return apiError(c, 'VALIDATION_FAILED', e instanceof Error ? e.message : '因子代码无效');
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
    return apiError(c, 'VALIDATION_FAILED', '预置因子只读,不能删除');
  }
  await prisma.factor.deleteMany({ where: { id, userId } });
  await prisma.factorReport.deleteMany({ where: { userId, factor: id } });
  return c.json({ ok: true });
});

// POST /custom/:id/fork — copy a factor's code (a builtin preset or one of your own) into a NEW
// editable custom factor — the "改参数出变体" research path (factor-to-strategy.md 路径②).
factorRoute.post('/custom/:id/fork', async (c) => {
  const userId = c.var.userId;
  const source = await prisma.factor.findFirst({
    where: { id: c.req.param('id'), userId: { in: [userId, BUILTIN_USER_ID] } },
    select: { name: true, code: true },
  });
  if (!source) {
    return apiError(c, 'NOT_FOUND', '因子不存在');
  }

  const name = await uniqueFactorName(userId, `${source.name} 副本`.slice(0, 40));
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
    return apiError(c, 'NOT_FOUND', '因子不存在');
  }
  const entity = { kind: 'factor' as const, id };
  if (turnBus.findRunning(entityKey(entity), userId)) {
    return apiError(c, 'VALIDATION_FAILED', '该因子已有正在进行的回复,请等它结束或取消');
  }

  const turnId = ulid();
  enqueueAgentTurn({
    turnId,
    userId,
    profile: factorProfile(),
    entity,
    message,
    currentCode: code,
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
  .refine((body) => body.code || body.prompt, { message: '需要 code 或 prompt' });

factorRoute.post('/name', validateJson(nameBody), async (c) => {
  const { code, prompt, currentName } = c.req.valid('json');
  let name: string;
  try {
    const system =
      code != null
        ? currentName
          ? `你是 A 股因子命名助手。读因子代码,它当前叫「${currentName}」。若这名称仍准确概括代码逻辑,就**原样返回它**;只有逻辑明显不符时才起一个更贴切的简短中文名(≤12字)。只输出名称本身——不要引号、解释、结尾标点。`
          : '你是 A 股因子命名助手。读因子代码,起一个简短中文名称(≤12字,概括其计算逻辑),只输出名称本身——不要引号、解释、结尾标点。'
        : '你是 A 股因子命名助手。读用户的自然语言因子需求,起一个简短中文名称(≤12字),只输出名称本身——不要引号、解释、结尾标点。';
    const raw = await chatText([
      { role: 'system', content: system },
      { role: 'user', content: code ?? prompt! },
    ]);
    name = raw
      .trim()
      .replace(/^["'「『]+|["'」』。.]+$/g, '')
      .slice(0, 16);
  } catch (e) {
    return apiError(c, 'SERVICE_UNAVAILABLE', e instanceof Error ? e.message : '命名失败');
  }
  return c.json({ name: name || '未命名因子' });
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
    return apiError(c, 'NOT_FOUND', '该窗口尚未计算,请先运行');
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
    return apiError(c, 'NOT_FOUND', '任务不存在或已过期');
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
      return apiError(c, 'NOT_FOUND', `未知因子 ${factor}`);
    }
  }
  if (start >= end) {
    return apiError(c, 'VALIDATION_FAILED', '起始日期必须早于结束日期');
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
      done('error', `因子分析进程异常退出 (code ${code})`);
    }
  });
  return c.json({ jobId });
});
