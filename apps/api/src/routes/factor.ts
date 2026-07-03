import { Worker } from 'node:worker_threads';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';
import type { FactorReport } from '@jixie/shared';
import { apiError, validateJson, validateQuery } from '../lib/httpError.js';
import { prisma } from '../lib/prisma.js';
import { FACTOR_CATALOG } from '../factor/factors.js';
import { compileFactor } from '../factor/compile-factor.js';
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

const CATALOG_KEYS = new Set(FACTOR_CATALOG.map((f) => f.key));
const reportId = (userId: string, factor: string, freq: string, start: string, end: string) =>
  `${userId}|${factor}|${freq}|${start}|${end}`;
const jobKey = (factor: string, freq: string, start: string, end: string) =>
  `${factor}|${freq}|${start}|${end}`;

// Worker entry: dev (tsx) spawns the .mjs bootstrap; prod spawns the compiled .js.
const workerUrl = import.meta.url.endsWith('.ts')
  ? new URL('../factor/factor-worker.boot.mjs', import.meta.url)
  : new URL('../factor/factor-worker.js', import.meta.url);

factorRoute.get('/catalog', async (c) => {
  // Preset factors + this user's custom factors (key = Factor id, kind = 'custom').
  const custom = await prisma.factor.findMany({
    where: { userId: c.var.userId },
    select: { id: true, name: true },
    orderBy: { updatedAt: 'desc' },
  });
  const customMeta = custom.map((f) => ({ key: f.id, label: f.name, kind: 'custom' as const }));
  return c.json([...FACTOR_CATALOG, ...customMeta]);
});

// —— Custom factors (code-first, mirrors saved strategies) ——
const factorBody = z.object({ name: z.string().min(1).max(40), code: z.string().min(1) });

factorRoute.get('/custom', async (c) => {
  const rows = await prisma.factor.findMany({
    where: { userId: c.var.userId },
    select: { id: true, name: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  });
  return c.json(rows);
});

factorRoute.get('/custom/:id', async (c) => {
  const row = await prisma.factor.findFirst({
    where: { id: c.req.param('id'), userId: c.var.userId },
    select: { id: true, name: true, code: true },
  });
  if (!row) {
    return apiError(c, 'NOT_FOUND', '因子不存在');
  }
  return c.json(row);
});

factorRoute.post('/custom', validateJson(factorBody), async (c) => {
  const userId = c.var.userId;
  const { name, code } = c.req.valid('json');
  // Compile-check before persisting — reject syntax / shape errors up front.
  try {
    await compileFactor(code);
  } catch (e) {
    return apiError(c, 'VALIDATION_FAILED', e instanceof Error ? e.message : '因子代码无效');
  }

  const existing = await prisma.factor.findUnique({
    where: { userId_name: { userId, name } },
    select: { id: true },
  });
  if (existing) {
    await prisma.factor.update({ where: { id: existing.id }, data: { code } });
    // Editing changes the factor values → its cached reports are stale.
    await prisma.factorReport.deleteMany({ where: { userId, factor: existing.id } });
    return c.json({ id: existing.id, name });
  }

  const id = ulid();
  await prisma.factor.create({ data: { id, userId, name, code } });
  return c.json({ id, name });
});

factorRoute.delete('/custom/:id', async (c) => {
  const userId = c.var.userId;
  const id = c.req.param('id');
  await prisma.factor.deleteMany({ where: { id, userId } });
  await prisma.factorReport.deleteMany({ where: { userId, factor: id } });
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
  if (!CATALOG_KEYS.has(factor)) {
    // Not a preset key → must be one of this user's custom factors (id).
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
  worker.on('message', (msg: { type: string; line?: string; message?: string }) => {
    if (msg.type === 'log') {
      appendLog(jobId, msg.line!);
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
