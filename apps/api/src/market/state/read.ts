import type { MarketStateScope, MarketStateScopeOption } from '@jixie/shared';
import { prisma } from '#infra/database/prisma.js';
import { MARKET_STATE_INDEX_CODES, MARKET_STYLE_INDEX_CODES } from '../registry/index-presets.js';
import {
  buildIndexTrailingReturns,
  buildMarketStateSnapshot,
  buildMarketStylePairs,
} from './compute.js';

export async function loadMarketState(scope: MarketStateScope) {
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
    return null;
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
    return null;
  }

  return snapshot;
}

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
