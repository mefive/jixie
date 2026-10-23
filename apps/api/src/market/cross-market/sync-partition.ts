import { EXTERNAL_FX_CODES } from '../registry/fx.js';
import { getDatabase } from '#infra/database/prisma.js';
import { CROSS_MARKET_BENCHMARK_BY_ID } from '../registry/cross-market-benchmarks.js';
import {
  US_NOMINAL_CURVE_SOURCE,
  US_NOMINAL_CURVE_CODE,
  US_NOMINAL_CURVE_NAME,
  US_REAL_CURVE_CODE,
  US_REAL_CURVE_NAME,
  US_TREASURY_CURVE_TYPE,
} from '../registry/yield-curves.js';
import type {
  MarketPartition,
  PreparedMarketPartition,
  SourceRecord,
} from '../synchronization/partition.js';
import { completeResponse, fetchSourcePages, type SyncSource } from '../synchronization/source.js';
import { parseCrossMarketBenchmarkRows } from './benchmark-sync.js';
import {
  assignExternalAvailableDates,
  parseExternalFxRows,
  parseExternalYieldCurveRows,
} from './external-drivers.js';

/**
 * 来源日期及币种原样保留；海外可得日继续映射到严格后续 SSE。
 *
 * Preserve source dates and currencies; overseas availability maps to a strictly later SSE session.
 */
export async function prepareExternalPartition(
  source: SyncSource,
  partition: MarketPartition,
  fetchedAt: Date,
): Promise<PreparedMarketPartition> {
  const calendar = await getDatabase().tradeCal.findMany({
    where: { exchange: 'SSE', isOpen: 1, calDate: { gt: partition.startDate } },
    orderBy: { calDate: 'asc' },
    select: { calDate: true },
  });
  const openDates = calendar.map((entry) => entry.calDate);
  if (partition.dataset === 'cross-market-benchmarks') {
    const definition = CROSS_MARKET_BENCHMARK_BY_ID.get(partition.scope);
    if (!definition) {
      throw new Error('Unknown cross-market benchmark');
    }
    const pages = await fetchSourcePages(
      source,
      definition.sourceApi,
      {
        ts_code: definition.providerCode,
        start_date: partition.startDate,
        end_date: partition.endDate,
      },
      'ts_code,trade_date,open,high,low,close,pre_close,change,pct_chg,swing,vol',
    );
    const records: SourceRecord[] = [];
    const errors: string[] = [];
    for (const row of pages.rows) {
      try {
        const parsed = parseCrossMarketBenchmarkRows(
          definition,
          [row],
          partition.startDate,
          partition.endDate,
        );
        const bar =
          definition.market === 'CN'
            ? { ...parsed[0], availableDate: parsed[0].tradeDate }
            : assignExternalAvailableDates(parsed, openDates)[0];
        records.push({
          values: { ...bar, retrievedAt: fetchedAt },
          availableDate: bar.availableDate,
          availabilityQuality: 'source_contract',
        });
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    const { sourceApi: _api, ...metadata } = definition;
    const result = completeResponse({
      pages,
      table: 'MarketBenchmarkDaily',
      extent: { basis: 'Filtered benchmark source contract' },
      records,
      errors,
      observedDates: records.map((record) => String(record.values.tradeDate)),
    });
    result.tables.unshift({ table: 'MarketBenchmark', records: [{ values: metadata }] });

    return result;
  }
  const fxCode = EXTERNAL_FX_CODES.find((code) => code === partition.scope);
  const fx = partition.dataset === 'external-fx';
  const real = partition.scope === 'real';
  if (fx && !fxCode) {
    throw new Error('Unknown external FX identity');
  }
  const fields = fx
    ? 'ts_code,trade_date,bid_open,bid_close,bid_high,bid_low,ask_open,ask_close,ask_high,ask_low,tick_qty'
    : real
      ? 'date,y5,y7,y10,y20,y30'
      : 'date,m1,m2,m3,m6,y1,y2,y3,y5,y7,y10,y20,y30';
  const pages = await fetchSourcePages(
    source,
    fx ? 'fx_daily' : real ? 'us_trycr' : 'us_tycr',
    {
      ...(fx ? { ts_code: partition.scope } : {}),
      start_date: partition.startDate,
      end_date: partition.endDate,
    },
    fields,
  );
  const records: SourceRecord[] = [];
  const errors: string[] = [];
  for (const row of pages.rows) {
    try {
      const values = fx
        ? assignExternalAvailableDates(
            parseExternalFxRows([row], fxCode!, partition.startDate, partition.endDate, {
              skipRoundingInversions: false,
            }),
            openDates,
          ).map((bar) => ({ ...bar, retrievedAt: fetchedAt }))
        : assignExternalAvailableDates(
            parseExternalYieldCurveRows(
              [row],
              real ? 'real' : 'nominal',
              partition.startDate,
              partition.endDate,
            ),
            openDates,
          ).map((point) => ({
            ...point,
            source: US_NOMINAL_CURVE_SOURCE,
            curveCode: real ? US_REAL_CURVE_CODE : US_NOMINAL_CURVE_CODE,
            curveName: real ? US_REAL_CURVE_NAME : US_NOMINAL_CURVE_NAME,
            curveType: US_TREASURY_CURVE_TYPE,
            retrievedAt: fetchedAt,
          }));
      records.push(
        ...values.map((value) => ({
          values: value,
          availableDate: value.availableDate,
          availabilityQuality: 'source_contract' as const,
        })),
      );
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return completeResponse({
    pages,
    table: fx ? 'FxDaily' : 'YieldCurvePoint',
    extent: { basis: 'Filtered external observation contract' },
    records,
    errors,
    observedDates: records.map((record) => String(record.values.tradeDate)),
  });
}
