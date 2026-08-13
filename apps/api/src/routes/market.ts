import { Hono } from 'hono';
import { z } from 'zod';
import { apiError, validateQuery } from '../lib/httpError.js';
import { prisma } from '../lib/prisma.js';
import { instrumentSeries } from '../market/instrument-series.js';
import { m } from '../i18n/index.js';
import { buildIndexValuationSeries } from '../market/index-valuation.js';
import {
  buildIndustryWeatherSeries,
  buildIndexWeatherSeries,
  buildIndexTrailingReturns,
  buildMarketStylePairs,
  buildMarketStateSnapshot,
  toUnifiedIndustryWeatherSeries,
} from '../market/market-state.js';
import type {
  IndustryIndicatorRow,
  IndexWeatherBasicRow,
  IndexWeatherIndicatorRow,
  SwIndexDailyRow,
} from '../market/market-state.js';
import {
  MAJOR_INDEX_DAILY_BASIC_CODES,
  MARKET_STATE_INDEX_CODES,
  MARKET_STYLE_INDEX_CODES,
  MARKET_WEATHER_INDEX_BENCHMARKS,
  MARKET_WEATHER_INDEX_GROUPS,
  MARKET_WEATHER_INDUSTRY_GROUPS,
  MARKET_WEATHER_INDEX_NAMES,
} from '../store/index-presets.js';
import type {
  IndustryWeatherSeries,
  MarketWeatherDimension,
  MarketWeatherSeries,
  MarketStateScope,
  MarketStateScopeOption,
  MarketWeatherFrequency,
} from '@jixie/shared';

/**
 * Market read-only helpers (cross-domain infrastructure, mounted at /api/app/market):
 *   GET /names?codes=                 tsCode → name (bulk) — e.g. the traded-instruments queue
 *   GET /objects/:assetType/:id/series a verified stock/ETF/index/future daily series
 *   GET /indices/:code/series         index daily close — the benchmark return curve in trade details
 *   GET /indices/valuation/catalog    broad-index valuation coverage
 *   GET /indices/:code/valuation      index close + valuation history and current percentiles
 *   GET /weather?dimension=&frequency= replayable card-only market weather dimensions
 *   GET /industry-weather?frequency=  legacy SW level-1 industry weather periods
 *   GET /state?scope=                  whole-market/index pulse + Shenwan level-1 direction heat
 * Naming rules: see docs/design/api-route-naming.md.
 */
export const marketRoute = new Hono();

// tsCode → name (bulk) — e.g. the traded-instruments queue in trade details.
marketRoute.get('/names', validateQuery(z.object({ codes: z.string().min(1) })), async (c) => {
  const codes = c.req.valid('query').codes.split(',').filter(Boolean).slice(0, 500);
  const [stocks, etfs, futures] = await Promise.all([
    prisma.stockBasic.findMany({
      where: { tsCode: { in: codes } },
      select: { tsCode: true, name: true },
    }),
    prisma.etfBasic.findMany({
      where: { tsCode: { in: codes } },
      select: { tsCode: true, name: true },
    }),
    prisma.futureContract.findMany({
      where: { tsCode: { in: codes } },
      select: { tsCode: true, name: true },
    }),
  ]);
  const names: Record<string, string> = Object.fromEntries(
    [...stocks, ...etfs, ...futures].map((row) => [row.tsCode, row.name]),
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

const marketStateScopes = ['all', ...MARKET_STATE_INDEX_CODES] as const;
const marketStateQuery = z.object({
  scope: z.enum(marketStateScopes).default('all'),
});
const marketWeatherFrequencies = ['week', 'month', 'quarter', 'year'] as const;
const industryWeatherQuery = z.object({
  frequency: z.enum(marketWeatherFrequencies).default('month'),
});
const marketWeatherDimensions = ['industry', 'scale', 'board', 'style'] as const;
const marketWeatherQuery = z.object({
  dimension: z.enum(marketWeatherDimensions).default('industry'),
  frequency: z.enum(marketWeatherFrequencies).default('month'),
});
const industryWeatherCache = new Map<string, IndustryWeatherSeries>();
const marketWeatherCache = new Map<string, MarketWeatherSeries>();
let industryWeatherRawCache:
  | {
      coverageKey: string;
      industryRows: IndustryIndicatorRow[];
      swIndexRows: SwIndexDailyRow[];
    }
  | undefined;

marketRoute.get('/objects/:assetType/:id/series', validateQuery(seriesQuery), async (c) => {
  const assetType = z.enum(['stock', 'etf', 'index', 'future']).safeParse(c.req.param('assetType'));
  if (!assetType.success) {
    return apiError(c, 'VALIDATION_FAILED', 'Unsupported object type.');
  }
  const id = c.req.param('id');
  const { start, end } = c.req.valid('query');
  if (start && end && start >= end) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'startAfterEnd'));
  }
  const series = await instrumentSeries(assetType.data, id, start, end);
  if (series.points.length === 0) {
    return apiError(c, 'NOT_FOUND', m(c, 'noDataInRange'));
  }
  return c.json(series);
});

marketRoute.get('/indices/valuation/catalog', async (c) => {
  const coverage = await prisma.indexDailyBasic.groupBy({
    by: ['tsCode'],
    where: { tsCode: { in: [...MAJOR_INDEX_DAILY_BASIC_CODES] } },
    _min: { tradeDate: true },
    _max: { tradeDate: true },
    _count: { _all: true },
  });
  const coverageByCode = new Map(coverage.map((row) => [row.tsCode, row]));
  const indices = MAJOR_INDEX_DAILY_BASIC_CODES.flatMap((tsCode) => {
    const row = coverageByCode.get(tsCode);
    return row?._min.tradeDate && row._max.tradeDate
      ? [
          {
            tsCode,
            startDate: row._min.tradeDate,
            endDate: row._max.tradeDate,
            rows: row._count._all,
          },
        ]
      : [];
  });

  return c.json({ indices });
});

marketRoute.get('/indices/:code/valuation', async (c) => {
  const tsCode = c.req.param('code').toUpperCase();
  if (!MAJOR_INDEX_DAILY_BASIC_CODES.some((code) => code === tsCode)) {
    return apiError(c, 'NOT_FOUND', m(c, 'noDataInRange'));
  }

  const [basicRows, closeRows] = await Promise.all([
    prisma.indexDailyBasic.findMany({
      where: { tsCode },
      select: {
        tsCode: true,
        tradeDate: true,
        pe: true,
        peTtm: true,
        pb: true,
        turnoverRate: true,
      },
      orderBy: { tradeDate: 'asc' },
    }),
    prisma.indexDaily.findMany({
      where: { tsCode },
      select: { tradeDate: true, close: true },
      orderBy: { tradeDate: 'asc' },
    }),
  ]);
  const series = buildIndexValuationSeries(tsCode, basicRows, closeRows);
  if (!series) {
    return apiError(c, 'NOT_FOUND', m(c, 'noDataInRange'));
  }

  return c.json(series);
});

marketRoute.get('/weather', validateQuery(marketWeatherQuery), async (c) => {
  const { dimension, frequency } = c.req.valid('query') as {
    dimension: MarketWeatherDimension;
    frequency: MarketWeatherFrequency;
  };
  if (dimension === 'industry') {
    const industrySeries = await loadIndustryWeatherSeries(frequency);
    if (!industrySeries) {
      return apiError(c, 'NOT_FOUND', m(c, 'noDataInRange'));
    }

    return c.json(toUnifiedIndustryWeatherSeries(industrySeries, MARKET_WEATHER_INDUSTRY_GROUPS));
  }

  const groups = MARKET_WEATHER_INDEX_GROUPS[dimension];
  const codes = groups.flatMap((group) => [...group.codes]);
  const referenceCodes = [
    ...new Set(codes.flatMap((code) => MARKET_WEATHER_INDEX_BENCHMARKS[code] ?? [])),
  ];
  const closeCodes = [...new Set([...codes, ...referenceCodes])];
  const [closeCoverage, indicatorCoverage, basicCoverage] = await Promise.all([
    prisma.indexDaily.aggregate({
      where: { tsCode: { in: codes } },
      _min: { tradeDate: true },
      _max: { tradeDate: true },
    }),
    prisma.indexIndicator.aggregate({
      where: { indexCode: { in: codes } },
      _max: { tradeDate: true },
    }),
    prisma.indexDailyBasic.aggregate({
      where: { tsCode: { in: codes } },
      _max: { tradeDate: true },
    }),
  ]);
  const cacheKey = [
    dimension,
    frequency,
    closeCoverage._max.tradeDate,
    indicatorCoverage._max.tradeDate,
    basicCoverage._max.tradeDate,
  ].join(':');
  const cached = marketWeatherCache.get(cacheKey);
  if (cached) {
    return c.json(cached);
  }

  const [closeRows, indicatorRows, officialBasicRows, benchmarkMetadataRows] = await Promise.all([
    prisma.indexDaily.findMany({
      where: { tsCode: { in: closeCodes } },
      select: { tsCode: true, tradeDate: true, close: true },
      orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }],
    }),
    prisma.indexIndicator.findMany({
      where: { indexCode: { in: codes } },
      select: {
        indexCode: true,
        tradeDate: true,
        return20: true,
        aboveMa20Ratio: true,
        aboveMa60Ratio: true,
        floatWeightedTurnoverRate: true,
        peTtm: true,
        pb: true,
        valuationCoverage: true,
      },
      orderBy: [{ indexCode: 'asc' }, { tradeDate: 'asc' }],
    }) as Promise<IndexWeatherIndicatorRow[]>,
    prisma.indexDailyBasic.findMany({
      where: { tsCode: { in: codes } },
      select: { tsCode: true, tradeDate: true, peTtm: true, pb: true },
      orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }],
    }),
    prisma.indexBenchmark.findMany({
      where: { tsCode: { in: closeCodes } },
      select: { tsCode: true, name: true },
    }),
  ]);
  const basicRows = mergeIndexWeatherValuations(officialBasicRows, indicatorRows);
  const benchmarkMetadataByCode = new Map(benchmarkMetadataRows.map((row) => [row.tsCode, row]));
  const metadataRows = closeCodes.map((tsCode) => ({
    tsCode,
    name: benchmarkMetadataByCode.get(tsCode)?.name ?? MARKET_WEATHER_INDEX_NAMES[tsCode] ?? tsCode,
  }));
  const series = buildIndexWeatherSeries(
    dimension,
    groups,
    closeRows,
    indicatorRows,
    basicRows,
    metadataRows,
    frequency,
    MARKET_WEATHER_INDEX_BENCHMARKS,
  );
  if (!series || !closeCoverage._min.tradeDate) {
    return apiError(c, 'NOT_FOUND', m(c, 'noDataInRange'));
  }

  for (const key of marketWeatherCache.keys()) {
    if (key.startsWith(`${dimension}:${frequency}:`)) {
      marketWeatherCache.delete(key);
    }
  }
  marketWeatherCache.set(cacheKey, series);
  return c.json(series);
});

marketRoute.get('/industry-weather', validateQuery(industryWeatherQuery), async (c) => {
  const frequency = c.req.valid('query').frequency as MarketWeatherFrequency;
  const series = await loadIndustryWeatherSeries(frequency);
  if (!series) {
    return apiError(c, 'NOT_FOUND', m(c, 'noDataInRange'));
  }

  return c.json(series);
});

function mergeIndexWeatherValuations(
  officialRows: Array<Omit<IndexWeatherBasicRow, 'source'>>,
  indicatorRows: IndexWeatherIndicatorRow[],
): IndexWeatherBasicRow[] {
  const rowsByKey = new Map<string, IndexWeatherBasicRow>();

  for (const row of indicatorRows) {
    if ((row.valuationCoverage ?? 0) < 0.8) {
      continue;
    }
    rowsByKey.set(`${row.indexCode}:${row.tradeDate}`, {
      tsCode: row.indexCode,
      tradeDate: row.tradeDate,
      peTtm: row.peTtm ?? null,
      pb: row.pb ?? null,
      source: 'constituents',
    });
  }
  for (const row of officialRows) {
    rowsByKey.set(`${row.tsCode}:${row.tradeDate}`, { ...row, source: 'official' });
  }

  return [...rowsByKey.values()].sort(
    (left, right) =>
      left.tsCode.localeCompare(right.tsCode) || left.tradeDate.localeCompare(right.tradeDate),
  );
}

async function loadIndustryWeatherSeries(
  frequency: MarketWeatherFrequency,
): Promise<IndustryWeatherSeries | null> {
  const [industryCoverage, swCoverage] = await Promise.all([
    prisma.industryIndicator.aggregate({
      _min: { tradeDate: true },
      _max: { tradeDate: true },
    }),
    prisma.swIndexDaily.aggregate({
      _min: { tradeDate: true },
      _max: { tradeDate: true },
    }),
  ]);
  const cacheKey = `${frequency}:${industryCoverage._max.tradeDate}:${swCoverage._max.tradeDate}`;
  const cached = industryWeatherCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const coverageKey = `${industryCoverage._max.tradeDate}:${swCoverage._max.tradeDate}`;
  if (!industryWeatherRawCache || industryWeatherRawCache.coverageKey !== coverageKey) {
    const [industryRows, swIndexRows] = await Promise.all([
      prisma.industryIndicator.findMany({
        select: {
          l1Code: true,
          l1Name: true,
          tradeDate: true,
          tradedCount: true,
          return20: true,
          excessReturn20: true,
          positiveReturn20Ratio: true,
          aboveMa20Ratio: true,
          aboveMa60Ratio: true,
          floatWeightedTurnoverRate: true,
          amountShare: true,
          topFiveAmountShare: true,
        },
        orderBy: [{ tradeDate: 'asc' }, { l1Code: 'asc' }],
      }),
      prisma.swIndexDaily.findMany({
        select: { tsCode: true, tradeDate: true, close: true, pe: true, pb: true },
        orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }],
      }),
    ]);
    industryWeatherRawCache = { coverageKey, industryRows, swIndexRows };
    industryWeatherCache.clear();
  }
  const { industryRows, swIndexRows } = industryWeatherRawCache;
  const series = buildIndustryWeatherSeries(industryRows, swIndexRows, frequency);
  if (!series) {
    return null;
  }

  for (const key of industryWeatherCache.keys()) {
    if (key.startsWith(`${frequency}:`)) {
      industryWeatherCache.delete(key);
    }
  }
  industryWeatherCache.set(cacheKey, series);
  return series;
}

marketRoute.get('/state', validateQuery(marketStateQuery), async (c) => {
  const scope = c.req.valid('query').scope as MarketStateScope;
  const [marketRows, marketCoverage, indexCoverage] = await Promise.all([
    scope === 'all'
      ? prisma.marketIndicator.findMany({ orderBy: { tradeDate: 'asc' } })
      : prisma.indexIndicator.findMany({
          where: { indexCode: scope },
          orderBy: { tradeDate: 'asc' },
        }),
    prisma.marketIndicator.aggregate({
      _min: { tradeDate: true },
      _max: { tradeDate: true },
    }),
    prisma.indexIndicator.groupBy({
      by: ['indexCode'],
      _min: { tradeDate: true },
      _max: { tradeDate: true },
    }),
  ]);
  const asOf = marketRows.at(-1)?.tradeDate;
  if (!asOf) {
    return apiError(c, 'NOT_FOUND', m(c, 'noDataInRange'));
  }

  const historyStart = `${Number(asOf.slice(0, 4)) - 3}${asOf.slice(4)}`;
  const latestIndexKeys = indexCoverage.flatMap((row) =>
    row._max.tradeDate ? [{ indexCode: row.indexCode, tradeDate: row._max.tradeDate }] : [],
  );
  const [
    industryRows,
    latestMarketRow,
    latestIndexRows,
    indexCloseRows,
    styleMetadataRows,
    swIndexRows,
  ] = await Promise.all([
    prisma.industryIndicator.findMany({
      where: { tradeDate: { gte: historyStart, lte: asOf } },
      orderBy: [{ tradeDate: 'asc' }, { l1Code: 'asc' }],
    }),
    prisma.marketIndicator.findFirst({
      orderBy: { tradeDate: 'desc' },
      select: {
        return20: true,
        aboveMa20Ratio: true,
        aboveMa60Ratio: true,
      },
    }),
    latestIndexKeys.length > 0
      ? prisma.indexIndicator.findMany({
          where: { OR: latestIndexKeys },
          select: {
            indexCode: true,
            return20: true,
            aboveMa20Ratio: true,
            aboveMa60Ratio: true,
          },
        })
      : [],
    prisma.indexDaily.findMany({
      where: {
        tsCode: { in: [...MARKET_STATE_INDEX_CODES, ...MARKET_STYLE_INDEX_CODES] },
        tradeDate: { gte: `${Number(asOf.slice(0, 4)) - 1}${asOf.slice(4)}`, lte: asOf },
      },
      select: { tsCode: true, tradeDate: true, close: true },
      orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }],
    }),
    prisma.indexBenchmark.findMany({
      where: { tsCode: { in: [...MARKET_STYLE_INDEX_CODES] }, indexType: '风格类指数' },
      select: { tsCode: true, name: true, bmkSource: true, indexType: true },
    }),
    prisma.swIndexDaily.findMany({
      where: {
        tradeDate: { gte: `${Number(asOf.slice(0, 4)) - 10}${asOf.slice(4)}`, lte: asOf },
      },
      select: { tsCode: true, tradeDate: true, close: true, pe: true, pb: true },
      orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }],
    }),
  ]);
  const trailingReturnsByCode = buildIndexTrailingReturns(indexCloseRows);
  const scopeOptions = buildMarketStateScopeOptions(
    marketCoverage,
    indexCoverage,
    latestMarketRow,
    latestIndexRows,
    trailingReturnsByCode,
  );
  const stylePairs = buildMarketStylePairs(indexCloseRows, styleMetadataRows);
  const snapshot = buildMarketStateSnapshot(marketRows, industryRows, {
    scope,
    scopeOptions,
    stylePairs,
    swIndexRows,
  });
  if (!snapshot) {
    return apiError(c, 'NOT_FOUND', m(c, 'noDataInRange'));
  }

  return c.json(snapshot);
});

function buildMarketStateScopeOptions(
  marketCoverage: {
    _min: { tradeDate: string | null };
    _max: { tradeDate: string | null };
  },
  indexCoverage: Array<{
    indexCode: string;
    _min: { tradeDate: string | null };
    _max: { tradeDate: string | null };
  }>,
  latestMarketRow: ScopeMetricRow | null,
  latestIndexRows: Array<ScopeMetricRow & { indexCode: string }>,
  trailingReturnsByCode: Map<
    string,
    Pick<MarketStateScopeOption, 'return5Day' | 'return20Day' | 'return60Day'>
  >,
): MarketStateScopeOption[] {
  const indexCoverageByCode = new Map(indexCoverage.map((row) => [row.indexCode, row]));
  const latestIndexByCode = new Map(latestIndexRows.map((row) => [row.indexCode, row]));
  const options: MarketStateScopeOption[] = [];

  if (marketCoverage._min.tradeDate && marketCoverage._max.tradeDate) {
    options.push({
      value: 'all',
      startDate: marketCoverage._min.tradeDate,
      endDate: marketCoverage._max.tradeDate,
      return5Day: null,
      return60Day: null,
      ...scopeMetrics(latestMarketRow),
    });
  }
  for (const indexCode of MARKET_STATE_INDEX_CODES) {
    const coverage = indexCoverageByCode.get(indexCode);
    if (coverage?._min.tradeDate && coverage._max.tradeDate) {
      options.push({
        value: indexCode,
        startDate: coverage._min.tradeDate,
        endDate: coverage._max.tradeDate,
        ...(trailingReturnsByCode.get(indexCode) ?? EMPTY_TRAILING_RETURNS),
        ...scopeMetrics(latestIndexByCode.get(indexCode) ?? null),
      });
    }
  }

  return options;
}

interface ScopeMetricRow {
  return20: number | null;
  aboveMa20Ratio: number | null;
  aboveMa60Ratio: number | null;
}

function scopeMetrics(
  row: ScopeMetricRow | null,
): Pick<MarketStateScopeOption, 'return20Day' | 'breadth'> {
  const breadthValues = [row?.aboveMa20Ratio, row?.aboveMa60Ratio].filter(
    (value): value is number => value != null,
  );

  return {
    return20Day: row?.return20 ?? null,
    breadth:
      breadthValues.length > 0
        ? breadthValues.reduce((sum, value) => sum + value, 0) / breadthValues.length
        : null,
  };
}

const EMPTY_TRAILING_RETURNS = {
  return5Day: null,
  return20Day: null,
  return60Day: null,
};

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
