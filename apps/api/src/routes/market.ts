import { Hono } from 'hono';
import { z } from 'zod';
import { apiError, validateQuery } from '../lib/httpError.js';
import { prisma } from '../lib/prisma.js';
import { stockSeries } from '../screen/query.js';
import { m } from '../i18n/index.js';

/**
 * Market read-only helpers (cross-domain infrastructure, mounted at /api/app/market):
 *   GET /names?codes=                 tsCode → name (bulk) — e.g. the traded-instruments queue
 *   GET /stocks/:code/series          a stock's OHLC/vol/pe series for the K-line/PE/volume charts
 *   GET /indices/:code/series         index daily close — the benchmark return curve in trade details
 * Naming rules: see docs/design/api-route-naming.md.
 */
export const marketRoute = new Hono();

// tsCode → name (bulk) — e.g. the traded-instruments queue in trade details.
marketRoute.get('/names', validateQuery(z.object({ codes: z.string().min(1) })), async (c) => {
  const codes = c.req.valid('query').codes.split(',').filter(Boolean).slice(0, 500);
  const rows = await prisma.stockBasic.findMany({
    where: { tsCode: { in: codes } },
    select: { tsCode: true, name: true },
  });
  return c.json(Object.fromEntries(rows.map((r) => [r.tsCode, r.name])) as Record<string, string>);
});

const seriesQuery = z.object({
  start: z
    .string()
    .regex(/^\d{8}$/)
    .optional(),
  end: z
    .string()
    .regex(/^\d{8}$/)
    .optional(),
});

marketRoute.get('/stocks/:code/series', validateQuery(seriesQuery), async (c) => {
  const code = c.req.param('code');
  const { start = '20150101', end = '20241231' } = c.req.valid('query');
  if (start >= end) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'startAfterEnd'));
  }
  const series = await stockSeries(code, start, end);
  if (series.points.length === 0) {
    return apiError(c, 'NOT_FOUND', m(c, 'noDataInRange'));
  }
  return c.json(series);
});

// Index daily close (e.g. 000300.SH CSI 300) over a range — the benchmark return curve in trade details.
marketRoute.get('/indices/:code/series', validateQuery(seriesQuery), async (c) => {
  const { start = '20150101', end = '20261231' } = c.req.valid('query');
  const rows = await prisma.indexDaily.findMany({
    where: { tsCode: c.req.param('code'), tradeDate: { gte: start, lte: end } },
    select: { tradeDate: true, close: true },
    orderBy: { tradeDate: 'asc' },
  });
  return c.json({ points: rows.map((r) => ({ date: r.tradeDate, close: r.close })) });
});
