import { marketRevision } from '../synchronization/readiness.js';
import { currentDerivedRows } from './current.js';
import type {
  IndustryWeatherSeries,
  MarketWeatherDimension,
  MarketWeatherFrequency,
  MarketWeatherSeries,
} from '@jixie/shared';
import { getDatabase } from '#infra/database/prisma.js';
import {
  MARKET_WEATHER_INDEX_BENCHMARKS,
  MARKET_WEATHER_INDEX_GROUPS,
  MARKET_WEATHER_INDEX_NAMES,
  MARKET_WEATHER_INDUSTRY_GROUPS,
} from '../registry/index-presets.js';
import type {
  IndexWeatherBasicRow,
  IndexWeatherIndicatorRow,
  IndustryIndicatorRow,
  SwIndexDailyRow,
} from './compute.js';
import {
  buildIndexWeatherSeries,
  buildIndustryWeatherSeries,
  industryWeatherToMarketWeather,
} from './compute.js';

/**
 * 组合市场、指数和行业气象，供市场看板查询。
 *
 * Load and combine market, index and industry weather for the dashboard.
 */
export async function loadMarketWeather(
  dimension: MarketWeatherDimension,
  frequency: MarketWeatherFrequency,
) {
  if (dimension === 'industry') {
    const industrySeries = await loadIndustryWeatherSeries(frequency);
    if (!industrySeries) {
      return null;
    }

    return industryWeatherToMarketWeather(industrySeries, MARKET_WEATHER_INDUSTRY_GROUPS);
  }

  const groups = MARKET_WEATHER_INDEX_GROUPS[dimension];
  const codes = groups.flatMap((group) => [...group.codes]);
  const referenceCodes = [
    ...new Set(codes.flatMap((code) => MARKET_WEATHER_INDEX_BENCHMARKS[code] ?? [])),
  ];
  const closeCodes = [...new Set([...codes, ...referenceCodes])];
  const [closeCoverage, indicatorCoverage, basicCoverage] = await Promise.all([
    getDatabase().indexDaily.aggregate({
      where: { tsCode: { in: codes } },
      _min: { tradeDate: true },
      _max: { tradeDate: true },
    }),
    getDatabase().indexIndicator.aggregate({
      where: { indexCode: { in: codes } },
      _max: { tradeDate: true },
    }),
    getDatabase().indexDailyBasic.aggregate({
      where: { tsCode: { in: codes } },
      _max: { tradeDate: true },
    }),
  ]);
  const cacheKey = [
    dimension,
    frequency,
    await marketRevision(),
    closeCoverage._max.tradeDate,
    indicatorCoverage._max.tradeDate,
    basicCoverage._max.tradeDate,
  ].join(':');
  const cached = marketWeatherCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const [closeRows, indicatorRows, officialBasicRows, benchmarkMetadataRows] = await Promise.all([
    getDatabase().indexDaily.findMany({
      where: { tsCode: { in: closeCodes } },
      select: { tsCode: true, tradeDate: true, close: true },
      orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }],
    }),
    getDatabase().indexIndicator.findMany({
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
    getDatabase().indexDailyBasic.findMany({
      where: { tsCode: { in: codes } },
      select: { tsCode: true, tradeDate: true, peTtm: true, pb: true },
      orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }],
    }),
    getDatabase().indexBenchmark.findMany({
      where: { tsCode: { in: closeCodes } },
      select: { tsCode: true, name: true },
    }),
  ]);
  const qualifiedRows = await currentDerivedRows(indicatorRows);
  const basicRows = mergeIndexWeatherValuations(officialBasicRows, qualifiedRows);
  const benchmarkMetadataByCode = new Map(benchmarkMetadataRows.map((row) => [row.tsCode, row]));
  const metadataRows = closeCodes.map((tsCode) => ({
    tsCode,
    name: benchmarkMetadataByCode.get(tsCode)?.name ?? MARKET_WEATHER_INDEX_NAMES[tsCode] ?? tsCode,
  }));
  const series = buildIndexWeatherSeries(
    dimension,
    groups,
    closeRows,
    qualifiedRows,
    basicRows,
    metadataRows,
    frequency,
    MARKET_WEATHER_INDEX_BENCHMARKS,
  );
  if (!series || !closeCoverage._min.tradeDate) {
    return null;
  }

  for (const key of marketWeatherCache.keys()) {
    if (key.startsWith(`${dimension}:${frequency}:`)) {
      marketWeatherCache.delete(key);
    }
  }
  marketWeatherCache.set(cacheKey, series);
  return series;
}

const industryWeatherCache = new Map<string, IndustryWeatherSeries>();

const marketWeatherCache = new Map<string, MarketWeatherSeries>();

let industryWeatherRawCache:
  | {
      coverageKey: string;
      industryRows: IndustryIndicatorRow[];
      swIndexRows: SwIndexDailyRow[];
    }
  | undefined;

/**
 * 按指数身份合并估值与状态气象，保留来源口径。
 *
 * Merge index valuations with weather by stable index identity.
 */
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

/**
 * 读取行业历史状态并构造周期气象序列。
 *
 * Load industry state history and construct period-specific weather.
 */
export async function loadIndustryWeatherSeries(
  frequency: MarketWeatherFrequency,
): Promise<IndustryWeatherSeries | null> {
  const [industryCoverage, swCoverage] = await Promise.all([
    getDatabase().industryIndicator.aggregate({
      _min: { tradeDate: true },
      _max: { tradeDate: true },
    }),
    getDatabase().swIndexDaily.aggregate({
      _min: { tradeDate: true },
      _max: { tradeDate: true },
    }),
  ]);
  const revision = await marketRevision();
  const cacheKey = `${frequency}:${revision}:${industryCoverage._max.tradeDate}:${swCoverage._max.tradeDate}`;
  const cached = industryWeatherCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const coverageKey = `${revision}:${industryCoverage._max.tradeDate}:${swCoverage._max.tradeDate}`;
  if (!industryWeatherRawCache || industryWeatherRawCache.coverageKey !== coverageKey) {
    const [industryRows, swIndexRows] = await Promise.all([
      getDatabase().industryIndicator.findMany({
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
      getDatabase().swIndexDaily.findMany({
        select: { tsCode: true, tradeDate: true, close: true, pe: true, pb: true },
        orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }],
      }),
    ]);
    industryWeatherRawCache = {
      coverageKey,
      industryRows: await currentDerivedRows(industryRows),
      swIndexRows,
    };
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
