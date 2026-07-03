import { Hono } from 'hono';
import { z } from 'zod';
import type { ScreenQueryResponse, ScreenSpec } from '@jixie/shared';
import { apiError, validateJson, validateQuery } from '../lib/httpError.js';
import { prisma } from '../lib/prisma.js';
import { chatJson } from '../llm/deepseek.js';
import { runScreen, screenForCodes, stockSeries } from '../screen/query.js';
import { nlToScreen } from '../screen/nl-to-screen.js';
import { resolveByNames, resolveInstruments } from '../screen/resolve.js';
import { screenSpecSchema } from '../screen/spec.js';

/**
 * Stock screener API (产品线 2). POST /screen runs a structured ScreenSpec against the latest
 * snapshot; GET /stock/:code/series returns a stock's OHLC/vol/pe series for the K线/PE/量 charts.
 */
export const screenRoute = new Hono();

// tsCode → name (bulk) — e.g. the traded-instruments queue in 交易详情.
screenRoute.get('/names', validateQuery(z.object({ codes: z.string().min(1) })), async (c) => {
  const codes = c.req.valid('query').codes.split(',').filter(Boolean).slice(0, 500);
  const rows = await prisma.stockBasic.findMany({
    where: { tsCode: { in: codes } },
    select: { tsCode: true, name: true },
  });
  return c.json(Object.fromEntries(rows.map((r) => [r.tsCode, r.name])) as Record<string, string>);
});

// Index daily close (e.g. 000300.SH 沪深300) over a range — the benchmark return curve in 交易详情.
const idxSeriesQuery = z.object({
  start: z
    .string()
    .regex(/^\d{8}$/)
    .optional(),
  end: z
    .string()
    .regex(/^\d{8}$/)
    .optional(),
});
screenRoute.get('/index/:code/series', validateQuery(idxSeriesQuery), async (c) => {
  const { start = '20150101', end = '20261231' } = c.req.valid('query');
  const rows = await prisma.indexDaily.findMany({
    where: { tsCode: c.req.param('code'), tradeDate: { gte: start, lte: end } },
    select: { tradeDate: true, close: true },
    orderBy: { tradeDate: 'asc' },
  });
  return c.json({ points: rows.map((r) => ({ date: r.tradeDate, close: r.close })) });
});

screenRoute.post('/screen', validateJson(screenSpecSchema), async (c) => {
  const spec = c.req.valid('json') as ScreenSpec;
  const result = await runScreen(spec);
  return c.json(result);
});

// One box, two intents. Resolve in one shot so the frontend gets results in a single call:
//   1. local LIKE first — a pure code / exact-or-fragment name resolves deterministically (no LLM, no
//      hallucinated codes), so direct lookups work even without a DEEPSEEK key;
//   2. only on a miss go to the LLM, which either returns a screen spec or normalizes a fuzzy name/拼音 to
//      a lookup we re-resolve in the DB.
const queryBody = z.object({ text: z.string().trim().min(1).max(500) });

screenRoute.post('/screen/query', validateJson(queryBody), async (c) => {
  const { text } = c.req.valid('json');

  // 1. Direct instrument reference? (deterministic, DB-backed)
  const direct = await resolveInstruments(text);
  if (direct.length) {
    const result = await screenForCodes(direct);
    return c.json({ kind: 'lookup', result } satisfies ScreenQueryResponse);
  }

  // 2. Fall back to the LLM: screen spec, or a normalized lookup.
  let parsed;
  try {
    parsed = await nlToScreen(text, chatJson);
  } catch (e) {
    return apiError(c, 'SERVICE_UNAVAILABLE', e instanceof Error ? e.message : 'NL→查询 调用失败');
  }
  if (!parsed.ok || !parsed.parse) {
    return apiError(
      c,
      'VALIDATION_FAILED',
      '没能把需求转成查询，换个说法、或直接输入股票名称/代码再试',
      {
        errors: parsed.errors,
      },
    );
  }

  if (parsed.parse.kind === 'lookup') {
    const codes = await resolveByNames(parsed.parse.names);
    if (!codes.length) {
      return apiError(c, 'NOT_FOUND', `没找到「${text}」对应的标的，请确认名称或代码`);
    }
    const result = await screenForCodes(codes);
    return c.json({ kind: 'lookup', result } satisfies ScreenQueryResponse);
  }

  const result = await runScreen(parsed.parse.spec);
  return c.json({ kind: 'screen', spec: parsed.parse.spec, result } satisfies ScreenQueryResponse);
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

screenRoute.get('/stock/:code/series', validateQuery(seriesQuery), async (c) => {
  const code = c.req.param('code');
  const { start = '20150101', end = '20241231' } = c.req.valid('query');
  if (start >= end) {
    return apiError(c, 'VALIDATION_FAILED', '起始日期必须早于结束日期');
  }
  const series = await stockSeries(code, start, end);
  if (series.points.length === 0) {
    return apiError(c, 'NOT_FOUND', '该标的在区间内无数据');
  }
  return c.json(series);
});
