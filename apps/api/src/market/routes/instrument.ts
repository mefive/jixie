import {
  instrumentNamesQuerySchema,
  instrumentSeriesQuerySchema,
  instrumentAssetTypeSchema,
} from '../schema.js';
import { Hono } from 'hono';
import { apiError, validateQuery } from '#infra/http/errors.js';
import { m } from '#infra/http/locale.js';
import { loadInstrumentNames } from '../instruments/names.js';
import { instrumentSeries } from '../queries/instrument-series.js';
import { loadIndexSeries } from '../indices/read.js';

export const marketInstrumentRoute = new Hono();

// tsCode → name (bulk) — e.g. the traded-instruments queue in trade details.
marketInstrumentRoute.get(
  '/instruments/names',
  validateQuery(instrumentNamesQuerySchema),
  async (c) => {
    const codes = c.req.valid('query').codes.split(',').filter(Boolean).slice(0, 500);
    return c.json(await loadInstrumentNames(codes));
  },
);

marketInstrumentRoute.get(
  '/instruments/:assetType/:instrumentId/series',
  validateQuery(instrumentSeriesQuerySchema),
  async (c) => {
    const assetType = instrumentAssetTypeSchema.safeParse(c.req.param('assetType'));
    if (!assetType.success) {
      return apiError(c, 'VALIDATION_FAILED', m(c, 'unsupportedInstrumentType'));
    }
    const instrumentId = c.req.param('instrumentId');
    const { start, end } = c.req.valid('query');
    if (start && end && start >= end) {
      return apiError(c, 'VALIDATION_FAILED', m(c, 'startAfterEnd'));
    }
    const series = await instrumentSeries(assetType.data, instrumentId, start, end);
    if (series.points.length === 0) {
      return apiError(c, 'NOT_FOUND', m(c, 'noDataInRange'));
    }
    return c.json(series);
  },
);

// Index daily close (e.g. 000300.SH CSI 300) over a range — the benchmark return curve in trade details.
marketInstrumentRoute.get(
  '/indices/:indexCode/series',
  validateQuery(instrumentSeriesQuerySchema),
  async (c) => {
    const { start = '20150101', end = '20261231' } = c.req.valid('query');
    return c.json(await loadIndexSeries(c.req.param('indexCode'), start, end));
  },
);
