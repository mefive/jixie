import { Hono } from 'hono';
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
 *   GET /analysis?factor&freq&start&end   a single-factor report, cached per 4-tuple (?refresh=1 recomputes)
 * Factor *values* are never stored — analyzeFactor() computes them on the fly; only the report is persisted.
 */
export const factorRoute = new Hono();

const CATALOG_KEYS = new Set(FACTOR_CATALOG.map((f) => f.key));

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
    const report = await analyzeFactor(factor, freq, start, end);
    const payload = JSON.stringify(report);
    await prisma.factorReport.upsert({
      where: { id },
      create: { id, factor, freq, start, end, payload, computedAt: new Date() },
      update: { payload, computedAt: new Date() },
    });
    return c.json(report);
  } catch (e) {
    return apiError(c, 'SERVICE_UNAVAILABLE', e instanceof Error ? e.message : '因子分析失败');
  }
});
