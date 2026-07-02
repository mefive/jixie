import { Worker } from 'node:worker_threads';
import { Hono } from 'hono';
import { z } from 'zod';
import type { FactorReport } from '@jixie/shared';
import { apiError, validateQuery } from '../lib/httpError.js';
import { prisma } from '../lib/prisma.js';
import { FACTOR_CATALOG } from '../factor/factors.js';
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

factorRoute.get('/catalog', (c) => c.json(FACTOR_CATALOG));

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
  if (!cached) return apiError(c, 'NOT_FOUND', '该窗口尚未计算,请先运行');
  return c.json(JSON.parse(cached.payload) as FactorReport);
});

factorRoute.get('/analysis/running', validateQuery(analysisQuery), async (c) => {
  const { factor, freq, start, end } = c.req.valid('query');
  const jobId = await findRunningJob(c.var.userId, 'factor', jobKey(factor, freq, start, end));
  return c.json({ jobId });
});

factorRoute.get('/analysis/job/:jobId', validateQuery(sinceQuery), async (c) => {
  const job = await getJob(c.req.param('jobId'), Number(c.req.valid('query').since ?? '0'));
  if (!job) return apiError(c, 'NOT_FOUND', '任务不存在或已过期');
  return c.json(job);
});

factorRoute.post('/analysis/run', validateQuery(analysisQuery), async (c) => {
  const userId = c.var.userId;
  const { factor, freq, start, end, refresh } = c.req.valid('query');
  if (!CATALOG_KEYS.has(factor)) return apiError(c, 'NOT_FOUND', `未知因子 ${factor}`);
  if (start >= end) return apiError(c, 'VALIDATION_FAILED', '起始日期必须早于结束日期');

  if (refresh !== '1') {
    const cached = await prisma.factorReport.findUnique({
      where: { id: reportId(userId, factor, freq, start, end) },
    });
    if (cached) return c.json({ done: true, report: JSON.parse(cached.payload) as FactorReport });
  }
  // Dedupe: re-attach to an in-flight job for the same analysis instead of spawning a duplicate worker.
  const existing = await findRunningJob(userId, 'factor', jobKey(factor, freq, start, end));
  if (existing) return c.json({ jobId: existing });

  const jobId = await createJob(userId, 'factor', jobKey(factor, freq, start, end));
  const worker = new Worker(workerUrl, { workerData: { userId, factor, freq, start, end } });
  let finished = false;
  const done = (status: 'done' | 'error', error?: string) => {
    if (finished) return;
    finished = true;
    void finishJob(jobId, status, error);
  };
  worker.on('message', (msg: { type: string; line?: string; message?: string }) => {
    if (msg.type === 'log') appendLog(jobId, msg.line!);
    else if (msg.type === 'done') done('done');
    else if (msg.type === 'error') done('error', msg.message);
  });
  worker.on('error', (err) => done('error', err.message));
  worker.on('exit', (code) => {
    if (code !== 0) done('error', `因子分析进程异常退出 (code ${code})`);
  });
  return c.json({ jobId });
});
