import type { ResearchAssetTypeV1, StockSeries } from '@jixie/shared';
import { prisma } from '../lib/prisma.js';

/** Load the chartable daily series for a verified object identity. */
export async function instrumentSeries(
  assetType: ResearchAssetTypeV1,
  tsCode: string,
  start?: string,
  end?: string,
): Promise<StockSeries> {
  const tradeDate = dateRange(start, end);
  if (assetType === 'etf') {
    return etfSeries(tsCode, tradeDate);
  }
  if (assetType === 'index') {
    return indexSeries(tsCode, tradeDate);
  }
  if (assetType === 'future') {
    return futureSeries(tsCode, start, end);
  }
  return stockSeries(tsCode, tradeDate);
}

type TradeDateRange = { gte?: string; lte?: string } | undefined;

function dateRange(start?: string, end?: string): TradeDateRange {
  return start || end
    ? { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) }
    : undefined;
}

async function etfSeries(tsCode: string, tradeDate: TradeDateRange): Promise<StockSeries> {
  const [basic, prices, factors] = await Promise.all([
    prisma.etfBasic.findUnique({ where: { tsCode }, select: { name: true } }),
    prisma.etfDaily.findMany({
      where: { tsCode, tradeDate },
      select: { tradeDate: true, open: true, high: true, low: true, close: true, vol: true },
      orderBy: { tradeDate: 'asc' },
    }),
    prisma.etfAdjFactor.findMany({
      where: { tsCode, tradeDate },
      select: { tradeDate: true, adjFactor: true },
    }),
  ]);
  const factorByDate = new Map(factors.map((row) => [row.tradeDate, row.adjFactor]));
  return {
    tsCode,
    name: basic?.name ?? tsCode,
    points: prices.map((row) => ({
      date: row.tradeDate,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      vol: row.vol,
      pe: null,
      adjFactor: factorByDate.get(row.tradeDate) ?? null,
    })),
  };
}

async function stockSeries(tsCode: string, tradeDate: TradeDateRange): Promise<StockSeries> {
  const [prices, valuations, factors, basic] = await Promise.all([
    prisma.daily.findMany({
      where: { tsCode, tradeDate },
      select: { tradeDate: true, open: true, high: true, low: true, close: true, vol: true },
      orderBy: { tradeDate: 'asc' },
    }),
    prisma.dailyBasic.findMany({
      where: { tsCode, tradeDate },
      select: { tradeDate: true, pe: true },
    }),
    prisma.adjFactor.findMany({
      where: { tsCode, tradeDate },
      select: { tradeDate: true, adjFactor: true },
    }),
    prisma.stockBasic.findUnique({ where: { tsCode }, select: { name: true } }),
  ]);
  const peByDate = new Map(valuations.map((row) => [row.tradeDate, row.pe]));
  const factorByDate = new Map(factors.map((row) => [row.tradeDate, row.adjFactor]));
  return {
    tsCode,
    name: basic?.name ?? tsCode,
    points: prices.map((row) => ({
      date: row.tradeDate,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      vol: row.vol,
      pe: peByDate.get(row.tradeDate) ?? null,
      adjFactor: factorByDate.get(row.tradeDate) ?? null,
    })),
  };
}

async function indexSeries(tsCode: string, tradeDate: TradeDateRange): Promise<StockSeries> {
  const [basic, prices, valuations] = await Promise.all([
    prisma.indexBenchmark.findUnique({ where: { tsCode }, select: { name: true } }),
    prisma.indexDaily.findMany({
      where: { tsCode, tradeDate },
      select: { tradeDate: true, close: true },
      orderBy: { tradeDate: 'asc' },
    }),
    prisma.indexDailyBasic.findMany({
      where: { tsCode, tradeDate },
      select: { tradeDate: true, pe: true },
    }),
  ]);
  const peByDate = new Map(valuations.map((row) => [row.tradeDate, row.pe]));
  return {
    tsCode,
    name: basic?.name ?? tsCode,
    points: prices.map((row) => ({
      date: row.tradeDate,
      open: row.close,
      high: row.close,
      low: row.close,
      close: row.close,
      vol: null,
      pe: peByDate.get(row.tradeDate) ?? null,
      adjFactor: null,
    })),
  };
}

async function futureSeries(tsCode: string, start?: string, end?: string): Promise<StockSeries> {
  const lower = start ?? '20150101';
  const upper = end ?? '20991231';
  const mappings = await prisma.futureMapping.findMany({
    where: { continuousCode: tsCode, tradeDate: { gte: lower, lte: upper } },
    select: { tradeDate: true, mappedTsCode: true },
    orderBy: { tradeDate: 'asc' },
  });
  const actualCodes = mappings.length
    ? [...new Set(mappings.map((row) => row.mappedTsCode))]
    : [tsCode];
  const [prices, contract] = await Promise.all([
    prisma.futureDaily.findMany({
      where: { tsCode: { in: actualCodes }, tradeDate: { gte: lower, lte: upper } },
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
    }),
    prisma.futureContract.findUnique({ where: { tsCode }, select: { name: true } }),
  ]);
  const byKey = new Map(prices.map((row) => [`${row.tsCode}|${row.tradeDate}`, row]));
  const selected = mappings.length
    ? mappings.flatMap((mapping) => {
        const row = byKey.get(`${mapping.mappedTsCode}|${mapping.tradeDate}`);
        return row ? [row] : [];
      })
    : prices;
  return {
    tsCode,
    name: contract?.name ?? tsCode,
    points: selected.map((row) => ({
      date: row.tradeDate,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      vol: row.volume,
      pe: null,
      adjFactor: null,
    })),
  };
}
