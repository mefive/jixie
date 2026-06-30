import { Hono } from 'hono';
import type { FactorReport } from '@jixie/shared';
import { apiError } from '../lib/httpError.js';
import { prisma } from '../lib/prisma.js';
import { analyzeFactors } from '../factor/analysis.js';

/**
 * Factor-analysis API (产品线 1.5 · 因子研究). GET /analysis returns one FactorReport per factor (deciles +
 * Rank IC + long-short). The report is the persisted artifact (FactorReportCache, a small JSON row):
 * factor *values* are never stored — analyzeFactors() computes them on the fly from raw tables when the
 * report is (re)generated. Served from the cache row instantly; `?refresh=1` recomputes + overwrites it.
 */
export const factorRoute = new Hono();

const REPORT_ID = 'default'; // single whole-market report for now (params → more rows later)

factorRoute.get('/analysis', async (c) => {
  const refresh = c.req.query('refresh') === '1';
  if (!refresh) {
    const cached = await prisma.factorReport.findUnique({ where: { id: REPORT_ID } });
    if (cached) return c.json(JSON.parse(cached.payload) as FactorReport[]);
  }
  try {
    const reports = await analyzeFactors();
    const payload = JSON.stringify(reports);
    await prisma.factorReport.upsert({
      where: { id: REPORT_ID },
      create: { id: REPORT_ID, payload, computedAt: new Date() },
      update: { payload, computedAt: new Date() },
    });
    return c.json(reports);
  } catch (e) {
    return apiError(c, 'SERVICE_UNAVAILABLE', e instanceof Error ? e.message : '因子分析失败');
  }
});
