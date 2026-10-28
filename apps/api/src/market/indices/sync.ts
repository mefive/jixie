import type { TradeDate } from '@jixie/shared';
import { getDatabase } from '#infra/database/prisma.js';
import { log } from '#infra/logging.js';
import { canonicalStockCode } from '../instruments/stock-identity.js';
import { indexDaily, indexDailyBasic, indexWeight } from '../providers/tushare/api.js';
import type { TushareClient } from '../providers/tushare/tushare-client.js';

const LARGE_INDEX_WEIGHT_CODES = new Set(['000985.CSI', '000001.SH', '399102.SZ', '932000.CSI']);

/**
 * 按月同步指数成分和权重，避免宽区间请求超过行数上限。
 *
 * Sync an index's monthly constituents (index_weight) over a date range. Large universes are fetched
 * month by month because one snapshot can exceed 5,000 constituents; smaller indices use quarterly
 * slices. Every slice is replaced atomically, so retries remain idempotent and resumable.
 */
export async function syncIndexWeight(
  client: TushareClient,
  indexCode: string,
  start: TradeDate,
  end: TradeDate,
): Promise<void> {
  const startYear = +start.slice(0, 4);
  const endYear = +end.slice(0, 4);
  const slices: [string, string][] = [];
  for (let year = startYear; year <= endYear; year++) {
    if (LARGE_INDEX_WEIGHT_CODES.has(indexCode)) {
      for (let month = 1; month <= 12; month++) {
        const monthText = String(month).padStart(2, '0');
        const monthEnd = new Date(Date.UTC(year, month, 0)).getUTCDate();
        slices.push([
          `${year}${monthText}01`,
          `${year}${monthText}${String(monthEnd).padStart(2, '0')}`,
        ]);
      }
    } else {
      slices.push([`${year}0101`, `${year}0331`], [`${year}0401`, `${year}0630`]);
      slices.push([`${year}0701`, `${year}0930`], [`${year}1001`, `${year}1231`]);
    }
  }
  log(`syncIndexWeight ${indexCode}: ${slices.length} slices`);

  let total = 0;
  for (const [sliceStart, sliceEnd] of slices) {
    const effectiveStart = sliceStart < start ? start : sliceStart;
    const effectiveEnd = sliceEnd > end ? end : sliceEnd;
    if (effectiveStart > effectiveEnd) {
      continue;
    }
    const rows = await indexWeight(client, {
      index_code: indexCode,
      start_date: effectiveStart,
      end_date: effectiveEnd,
    });
    if (rows.length === 0) {
      const existingRows = await getDatabase().indexWeight.count({
        where: { indexCode, tradeDate: { gte: effectiveStart, lte: effectiveEnd } },
      });
      if (existingRows > 0) {
        log(
          `  syncIndexWeight ${indexCode} ${effectiveStart}~${effectiveEnd}: provider returned no rows; preserving ${existingRows} existing rows`,
        );
      }
      continue;
    }
    const weightByDate = new Map<string, number>();
    for (const row of rows) {
      weightByDate.set(row.trade_date, (weightByDate.get(row.trade_date) ?? 0) + (row.weight ?? 0));
    }
    for (const [tradeDate, weight] of weightByDate) {
      if (weight < 95 || weight > 105) {
        throw new Error(
          `IndexWeight ${indexCode} ${tradeDate} sums to ${weight.toFixed(2)}; refusing a possibly truncated snapshot`,
        );
      }
    }
    await getDatabase().$transaction([
      getDatabase().indexWeight.deleteMany({
        where: { indexCode, tradeDate: { gte: effectiveStart, lte: effectiveEnd } },
      }),
      getDatabase().indexWeight.createMany({
        data: rows.map((r) => ({
          indexCode: r.index_code,
          conCode: canonicalStockCode(r.con_code),
          tradeDate: r.trade_date,
          weight: r.weight,
        })),
      }),
    ]);
    total += rows.length;
  }
  log(`syncIndexWeight 完成，共 ${total} 行`);
}

/**
 * 同步指数日收盘并对请求分段，避免上游行数截断。
 *
 * Sync an index's daily close (e.g. 000300.SH) — for benchmark return curves. The upstream endpoint
 * truncates large responses, so the requested range is fetched in ten-year windows.
 */
export async function syncIndexDaily(
  client: TushareClient,
  indexCode: string,
  start: TradeDate,
  end: TradeDate,
): Promise<void> {
  const startYear = Number(start.slice(0, 4));
  const endYear = Number(end.slice(0, 4));
  let total = 0;

  for (let windowStartYear = startYear; windowStartYear <= endYear; windowStartYear += 10) {
    const windowEndYear = Math.min(windowStartYear + 9, endYear);
    const windowStart = `${windowStartYear}0101` < start ? start : `${windowStartYear}0101`;
    const windowEnd = `${windowEndYear}1231` > end ? end : `${windowEndYear}1231`;
    const rows = await indexDaily(client, {
      ts_code: indexCode,
      start_date: windowStart,
      end_date: windowEnd,
    });

    await getDatabase().$transaction([
      getDatabase().indexDaily.deleteMany({
        where: { tsCode: indexCode, tradeDate: { gte: windowStart, lte: windowEnd } },
      }),
      getDatabase().indexDaily.createMany({
        data: rows.map((row) => ({
          tsCode: row.ts_code,
          tradeDate: row.trade_date,
          close: row.close,
        })),
      }),
    ]);
    total += rows.length;
  }

  log(`syncIndexDaily ${indexCode}: ${total} 行`);
}

/**
 * 分段同步主要宽基指数每日估值，遵守上游行数限制。
 *
 * Sync provider-computed daily valuation metrics for broad-market indices. The upstream endpoint has
 * a 3,000-row response cap, so each code is fetched in ten-year windows.
 */
export async function syncIndexDailyBasic(
  client: TushareClient,
  indexCodes: string[],
  start: TradeDate,
  end: TradeDate,
): Promise<void> {
  const startYear = Number(start.slice(0, 4));
  const endYear = Number(end.slice(0, 4));

  for (const indexCode of indexCodes) {
    let total = 0;
    for (let windowStartYear = startYear; windowStartYear <= endYear; windowStartYear += 10) {
      const windowEndYear = Math.min(windowStartYear + 9, endYear);
      const windowStart = `${windowStartYear}0101` < start ? start : `${windowStartYear}0101`;
      const windowEnd = `${windowEndYear}1231` > end ? end : `${windowEndYear}1231`;
      const rows = await indexDailyBasic(client, {
        ts_code: indexCode,
        start_date: windowStart,
        end_date: windowEnd,
      });
      await getDatabase().$transaction([
        getDatabase().indexDailyBasic.deleteMany({
          where: {
            tsCode: indexCode,
            tradeDate: { gte: windowStart, lte: windowEnd },
          },
        }),
        getDatabase().indexDailyBasic.createMany({
          data: rows.map((row) => ({
            tsCode: row.ts_code,
            tradeDate: row.trade_date,
            totalMv: row.total_mv,
            floatMv: row.float_mv,
            totalShare: row.total_share,
            floatShare: row.float_share,
            freeShare: row.free_share,
            turnoverRate: row.turnover_rate,
            turnoverRateF: row.turnover_rate_f,
            pe: row.pe,
            peTtm: row.pe_ttm,
            pb: row.pb,
          })),
        }),
      ]);
      total += rows.length;
      log(`  syncIndexDailyBasic ${indexCode} ${windowStart}~${windowEnd}: ${rows.length} 行`);
    }
    log(`syncIndexDailyBasic ${indexCode} 完成，共 ${total} 行`);
  }
}
