import type { TradeDate } from '@jixie/shared';
import { prisma } from '#infra/database/prisma.js';
import { log } from '#infra/logging.js';
import { canonicalStockCode } from '../instruments/stock-identity.js';
import {
  indexBenchmark,
  indexClassify,
  indexDaily,
  indexDailyBasic,
  indexMemberAll,
  indexWeight,
  swDaily,
} from '../providers/tushare/api.js';
import type { TushareClient } from '../providers/tushare/client.js';

const LARGE_INDEX_WEIGHT_CODES = new Set(['000985.CSI', '000001.SH', '399102.SZ', '932000.CSI']);

/**
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
      const existingRows = await prisma.indexWeight.count({
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
    await prisma.$transaction([
      prisma.indexWeight.deleteMany({
        where: { indexCode, tradeDate: { gte: effectiveStart, lte: effectiveEnd } },
      }),
      prisma.indexWeight.createMany({
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
 * Sync Shenwan (SW2021) level-1 industry membership — the point-in-time (stock → industry) map used
 * for industry-neutralization in factor analysis. Fetches the 31 level-1 industries, then for each
 * pulls current ('Y') + historical ('N') members and unions them so every membership spell (with its
 * in/out dates) is captured. Full overwrite — small volume (~tens of thousands of rows total).
 */
export async function syncSwIndustry(client: TushareClient): Promise<number> {
  const industries = await indexClassify(client, { level: 'L1', src: 'SW2021' });
  log(`syncSwIndustry: ${industries.length} 个申万一级行业`);

  // De-dup by (tsCode, l1Code, inDate) — the 'Y' and 'N' fetches can both return a current spell.
  const seen = new Set<string>();
  const rows: {
    tsCode: string;
    l1Code: string;
    l1Name: string;
    inDate: string;
    outDate: string | null;
  }[] = [];
  for (const industry of industries) {
    for (const isNew of ['Y', 'N']) {
      const members = await indexMemberAll(client, { l1_code: industry.index_code, is_new: isNew });
      for (const member of members) {
        const tsCode = canonicalStockCode(member.ts_code);
        const key = `${tsCode}|${member.l1_code}|${member.in_date}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        rows.push({
          tsCode,
          l1Code: member.l1_code,
          l1Name: member.l1_name,
          inDate: member.in_date,
          outDate: member.out_date,
        });
      }
    }
    log(`  ${industry.industry_name}: 累计 ${rows.length} 行`);
  }

  await prisma.$transaction([
    prisma.swIndustryMember.deleteMany({}),
    prisma.swIndustryMember.createMany({ data: rows }),
  ]);
  log(`syncSwIndustry 完成，共 ${rows.length} 行`);
  return rows.length;
}

/** Replace the small official benchmark catalog used to audit index classifications. */
export async function syncIndexBenchmarks(client: TushareClient): Promise<number> {
  const rows = await indexBenchmark(client);

  await prisma.$transaction([
    prisma.indexBenchmark.deleteMany({}),
    prisma.indexBenchmark.createMany({
      data: rows.map((row) => ({
        tsCode: row.ts_code,
        symbol: row.symbol,
        name: row.name,
        fullName: row.fullname,
        bmkLevel: row.bmk_level,
        bmkType: row.bmk_type,
        bmkSource: row.bmk_src,
        indexType: row.idx_type,
      })),
    }),
  ]);
  log(`syncIndexBenchmarks complete: ${rows.length} rows`);
  return rows.length;
}

/** Sync official SW2021 level-1 industry bars. A single-date refresh uses one upstream call; range
 * backfills fetch one industry at a time to stay under the response cap. */
export async function syncSwIndexDaily(
  client: TushareClient,
  start: TradeDate,
  end: TradeDate,
): Promise<number> {
  const industries = await indexClassify(client, { level: 'L1', src: 'SW2021' });
  const allowedCodes = new Set(industries.map((industry) => industry.index_code));
  let rows = [] as Awaited<ReturnType<typeof swDaily>>;

  if (start === end) {
    const dateRows = await swDaily(client, { trade_date: start });
    rows = dateRows.filter((row) => allowedCodes.has(row.ts_code));
  } else {
    for (const industry of industries) {
      const industryRows = await swDaily(client, {
        ts_code: industry.index_code,
        start_date: start,
        end_date: end,
      });
      rows.push(...industryRows);
    }
  }

  await prisma.$transaction([
    prisma.swIndexDaily.deleteMany({
      where: { tradeDate: { gte: start, lte: end }, tsCode: { in: [...allowedCodes] } },
    }),
    prisma.swIndexDaily.createMany({
      data: rows.map((row) => ({
        tsCode: row.ts_code,
        tradeDate: row.trade_date,
        name: row.name,
        open: row.open,
        low: row.low,
        high: row.high,
        close: row.close,
        change: row.change,
        pctChange: row.pct_change,
        volume: row.vol,
        amount: row.amount,
        pe: row.pe,
        pb: row.pb,
        floatMv: row.float_mv,
        totalMv: row.total_mv,
      })),
    }),
  ]);
  log(`syncSwIndexDaily ${start}..${end}: ${rows.length} rows`);
  return rows.length;
}

/** Sync an index's daily close (e.g. 000300.SH) — for benchmark return curves. The upstream endpoint
 * truncates large responses, so the requested range is fetched in ten-year windows. */
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

    await prisma.$transaction([
      prisma.indexDaily.deleteMany({
        where: { tsCode: indexCode, tradeDate: { gte: windowStart, lte: windowEnd } },
      }),
      prisma.indexDaily.createMany({
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

/** Sync provider-computed daily valuation metrics for broad-market indices. The upstream endpoint has
 * a 3,000-row response cap, so each code is fetched in ten-year windows. */
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
      await prisma.$transaction([
        prisma.indexDailyBasic.deleteMany({
          where: {
            tsCode: indexCode,
            tradeDate: { gte: windowStart, lte: windowEnd },
          },
        }),
        prisma.indexDailyBasic.createMany({
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
