import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FactorReport } from '@jixie/shared';
import { apiError, validateQuery } from '../lib/httpError.js';
import { prisma } from '../lib/prisma.js';
import { analyzeFactor } from '../factor/analysis.js';
import { FACTOR_CATALOG } from '../factor/factors.js';

/**
 * Factor-analysis API (产品线 1.5 · 因子研究).
 *   GET /catalog                 the factor list (identity + kind) — drives the /factors page list
 *   GET /runs?factor=X           a factor's cached runs (the "已跑" chips)
 *   GET /analysis?factor&freq&start&end   a single-factor report, cached per 4-tuple (sync; ?refresh=1 recomputes)
 *   POST /analysis/run           start (or return cached); streams progress via a job — the 运行 button uses this
 *   GET /analysis/job/:id?since= poll a running analysis: {status, logs, report?, error?}
 * Factor *values* are never stored — analyzeFactor() computes them on the fly; only the report is persisted.
 */
export const factorRoute = new Hono();

const CATALOG_KEYS = new Set(FACTOR_CATALOG.map((f) => f.key));

// Compute one factor's report + persist it (streaming progress via onLog). Shared by the sync + job paths.
async function computeAndCache(
  factor: string,
  freq: 'month' | 'week',
  start: string,
  end: string,
  onLog: (msg: string) => void = () => {},
): Promise<FactorReport> {
  const report = await analyzeFactor(factor, freq, start, end, onLog);
  const payload = JSON.stringify(report);
  const id = `${factor}|${freq}|${start}|${end}`;
  await prisma.factorReport.upsert({
    where: { id },
    create: { id, factor, freq, start, end, payload, computedAt: new Date() },
    update: { payload, computedAt: new Date() },
  });
  return report;
}

factorRoute.get('/catalog', (c) => c.json(FACTOR_CATALOG));

const runsQuery = z.object({ factor: z.string().min(1) });
factorRoute.get('/runs', validateQuery(runsQuery), async (c) => {
  const { factor } = c.req.valid('query');
  const rows = await prisma.factorReport.findMany({
    where: { factor },
    select: { freq: true, start: true, end: true, computedAt: true },
    orderBy: { computedAt: 'desc' },
  });
  return c.json(rows);
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
factorRoute.get('/analysis', validateQuery(analysisQuery), async (c) => {
  const { factor, freq, start, end, refresh } = c.req.valid('query');
  if (!CATALOG_KEYS.has(factor)) return apiError(c, 'NOT_FOUND', `未知因子 ${factor}`);
  if (start >= end) return apiError(c, 'VALIDATION_FAILED', '起始日期必须早于结束日期');

  const id = `${factor}|${freq}|${start}|${end}`;
  if (refresh !== '1') {
    const cached = await prisma.factorReport.findUnique({ where: { id } });
    if (cached) return c.json(JSON.parse(cached.payload) as FactorReport);
  }
  try {
    return c.json(await computeAndCache(factor, freq, start, end));
  } catch (e) {
    return apiError(c, 'SERVICE_UNAVAILABLE', e instanceof Error ? e.message : '因子分析失败');
  }
});

// —— Streamed analysis (progress logs, like the backtest) via an in-process job + poll ——

interface AnalysisJob {
  logs: string[];
  status: 'running' | 'done' | 'error';
  report?: FactorReport;
  error?: string;
}
const jobs = new Map<string, AnalysisJob>();

factorRoute.post('/analysis/run', validateQuery(analysisQuery), async (c) => {
  const { factor, freq, start, end, refresh } = c.req.valid('query');
  if (!CATALOG_KEYS.has(factor)) return apiError(c, 'NOT_FOUND', `未知因子 ${factor}`);
  if (start >= end) return apiError(c, 'VALIDATION_FAILED', '起始日期必须早于结束日期');

  // Cache hit (and not forcing recompute) → return the report directly, no job.
  if (refresh !== '1') {
    const cached = await prisma.factorReport.findUnique({
      where: { id: `${factor}|${freq}|${start}|${end}` },
    });
    if (cached) return c.json({ done: true, report: JSON.parse(cached.payload) as FactorReport });
  }

  const jobId = randomUUID();
  const job: AnalysisJob = { logs: [], status: 'running' };
  jobs.set(jobId, job);
  void (async () => {
    try {
      job.report = await computeAndCache(factor, freq, start, end, (msg) => job.logs.push(msg));
      job.status = 'done';
    } catch (e) {
      job.error = e instanceof Error ? e.message : '因子分析失败';
      job.status = 'error';
    }
    setTimeout(() => jobs.delete(jobId), 5 * 60 * 1000); // evict finished jobs after 5 min
  })();
  return c.json({ jobId });
});

factorRoute.get('/analysis/job/:jobId', async (c) => {
  const job = jobs.get(c.req.param('jobId'));
  if (!job) return apiError(c, 'NOT_FOUND', '任务不存在或已过期');
  const since = Number(c.req.query('since') ?? 0) || 0;
  return c.json({
    status: job.status,
    logs: job.logs.slice(since),
    report: job.report,
    error: job.error,
  });
});
