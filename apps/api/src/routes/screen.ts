import { Hono } from 'hono';
import { z } from 'zod';
import type { ScreenSpec } from '@jixie/shared';
import { apiError, validateJson, validateQuery } from '../lib/httpError.js';
import { chatJson } from '../llm/deepseek.js';
import { runScreen, stockSeries } from '../screen/query.js';
import { nlToScreen } from '../screen/nl-to-screen.js';
import { screenSpecSchema } from '../screen/spec.js';

/**
 * Stock screener API (产品线 2). POST /screen runs a structured ScreenSpec against the latest
 * snapshot; GET /stock/:code/series returns a stock's OHLC/vol/pe series for the K线/PE/量 charts.
 */
export const screenRoute = new Hono();

screenRoute.post('/screen', validateJson(screenSpecSchema), async (c) => {
  const spec = c.req.valid('json') as ScreenSpec;
  const result = await runScreen(spec);
  return c.json(result);
});

// NL→ScreenSpec → run it in one shot (so the frontend gets results + the editable spec together).
const parseBody = z.object({ text: z.string().trim().min(1).max(500) });

screenRoute.post('/screen/parse', validateJson(parseBody), async (c) => {
  const { text } = c.req.valid('json');

  let parsed;
  try {
    parsed = await nlToScreen(text, chatJson);
  } catch (e) {
    return apiError(c, 'SERVICE_UNAVAILABLE', e instanceof Error ? e.message : 'NL→查询 调用失败');
  }
  if (!parsed.ok || !parsed.spec) {
    return apiError(c, 'VALIDATION_FAILED', '没能把需求转成合法查询，请换个说法再试', {
      errors: parsed.errors,
    });
  }
  const result = await runScreen(parsed.spec);
  return c.json({ spec: parsed.spec, result });
});

const seriesQuery = z.object({
  start: z.string().regex(/^\d{8}$/).optional(),
  end: z.string().regex(/^\d{8}$/).optional(),
});

screenRoute.get('/stock/:code/series', validateQuery(seriesQuery), async (c) => {
  const code = c.req.param('code');
  const { start = '20150101', end = '20241231' } = c.req.valid('query');
  if (start >= end) return apiError(c, 'VALIDATION_FAILED', '起始日期必须早于结束日期');
  const series = await stockSeries(code, start, end);
  if (series.points.length === 0) return apiError(c, 'NOT_FOUND', '该标的在区间内无数据');
  return c.json(series);
});
