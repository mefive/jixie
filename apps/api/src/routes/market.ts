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
  const [stocks, futures] = await Promise.all([
    prisma.stockBasic.findMany({
      where: { tsCode: { in: codes } },
      select: { tsCode: true, name: true },
    }),
    prisma.futureContract.findMany({
      where: { tsCode: { in: codes } },
      select: { tsCode: true, name: true },
    }),
  ]);
  const names: Record<string, string> = Object.fromEntries(
    [...stocks, ...futures].map((row) => [row.tsCode, row.name]),
  );
  const continuousNames: Record<string, string> = {
    'IF.CFX': '沪深300股指期货主力',
    'IH.CFX': '上证50股指期货主力',
    'IC.CFX': '中证500股指期货主力',
    'IM.CFX': '中证1000股指期货主力',
  };
  for (const code of codes) {
    if (continuousNames[code]) {
      names[code] = continuousNames[code];
    }
  }
  return c.json(names);
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

// Actual or point-in-time mapped continuous stock-index futures OHLC series.
marketRoute.get('/futures/:code/series', validateQuery(seriesQuery), async (c) => {
  const code = c.req.param('code');
  const { start = '20150101', end = '20261231' } = c.req.valid('query');
  const mappings = await prisma.futureMapping.findMany({
    where: { continuousCode: code, tradeDate: { gte: start, lte: end } },
    select: { tradeDate: true, mappedTsCode: true },
    orderBy: { tradeDate: 'asc' },
  });
  const actualCodes = mappings.length
    ? [...new Set(mappings.map((row) => row.mappedTsCode))]
    : [code];
  const rows = await prisma.futureDaily.findMany({
    where: { tsCode: { in: actualCodes }, tradeDate: { gte: start, lte: end } },
    select: {
      tsCode: true,
      tradeDate: true,
      open: true,
      high: true,
      low: true,
      close: true,
      volume: true,
    },
    orderBy: { tradeDate: 'asc' },
  });
  const rowByKey = new Map(rows.map((row) => [`${row.tsCode}|${row.tradeDate}`, row]));
  const selectedRows = mappings.length
    ? mappings
        .map((mapping) => rowByKey.get(`${mapping.mappedTsCode}|${mapping.tradeDate}`))
        .filter((row): row is (typeof rows)[number] => row != null)
    : rows;
  if (selectedRows.length === 0) {
    return apiError(c, 'NOT_FOUND', m(c, 'noDataInRange'));
  }
  return c.json({
    tsCode: code,
    name: code,
    points: selectedRows.map((row) => ({
      date: row.tradeDate,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      vol: row.volume,
      pe: null,
      adjFactor: null,
    })),
  });
});
