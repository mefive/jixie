import type { ResearchAssetTypeV1, StockSeries } from '@jixie/shared';
import { getDatabase } from '#infra/database/prisma.js';

/**
 * 为已验证对象身份加载可绘图日序列。
 *
 * Load the chartable daily series for a verified object identity.
 */
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
  return stockSeries(tsCode, tradeDate);
}

/**
 * 封装已校验行情日期边界，供各资产查询共用。
 *
 * Carry validated instrument-series date bounds across asset loaders.
 */
type TradeDateRange = { gte?: string; lte?: string } | undefined;

/**
 * 解析并校验行情序列日期范围，供各资产查询共用。
 *
 * Resolve and validate date bounds shared by instrument-series queries.
 */
function dateRange(start?: string, end?: string): TradeDateRange {
  return start || end
    ? { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) }
    : undefined;
}

/**
 * 读取 ETF 原始日线并映射图表指标，保留份额与复权口径。
 *
 * Load ETF daily bars and map chart measures with explicit share-size and adjustment conventions.
 */
async function etfSeries(tsCode: string, tradeDate: TradeDateRange): Promise<StockSeries> {
  const [basic, prices, factors] = await Promise.all([
    getDatabase().etfBasic.findUnique({ where: { tsCode }, select: { name: true } }),
    getDatabase().etfDaily.findMany({
      where: { tsCode, tradeDate },
      select: { tradeDate: true, open: true, high: true, low: true, close: true, vol: true },
      orderBy: { tradeDate: 'asc' },
    }),
    getDatabase().etfAdjFactor.findMany({
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

/**
 * 读取股票行情及所选指标，形成统一绘图序列。
 *
 * Load stock prices and selected measures into a common chart series.
 */
async function stockSeries(tsCode: string, tradeDate: TradeDateRange): Promise<StockSeries> {
  const [prices, valuations, factors, basic] = await Promise.all([
    getDatabase().daily.findMany({
      where: { tsCode, tradeDate },
      select: { tradeDate: true, open: true, high: true, low: true, close: true, vol: true },
      orderBy: { tradeDate: 'asc' },
    }),
    getDatabase().dailyBasic.findMany({
      where: { tsCode, tradeDate },
      select: { tradeDate: true, pe: true },
    }),
    getDatabase().adjFactor.findMany({
      where: { tsCode, tradeDate },
      select: { tradeDate: true, adjFactor: true },
    }),
    getDatabase().stockBasic.findUnique({ where: { tsCode }, select: { name: true } }),
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

/**
 * 读取指数行情或估值，形成统一绘图序列。
 *
 * Load index prices or valuation measures into a common chart series.
 */
async function indexSeries(tsCode: string, tradeDate: TradeDateRange): Promise<StockSeries> {
  const [basic, prices, valuations] = await Promise.all([
    getDatabase().indexBenchmark.findUnique({ where: { tsCode }, select: { name: true } }),
    getDatabase().indexDaily.findMany({
      where: { tsCode, tradeDate },
      select: { tradeDate: true, close: true },
      orderBy: { tradeDate: 'asc' },
    }),
    getDatabase().indexDailyBasic.findMany({
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
