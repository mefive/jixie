import type { TradeDate } from '@jixie/shared';
import { prisma } from '#infra/database/prisma.js';
import { log } from '#infra/logging.js';
import { etfBasic, fundAdj, fundBasic, fundDaily } from '../providers/tushare/api.js';
import type { TushareClient } from '../providers/tushare/client.js';

function supportsSameDayTurnover(row: {
  name: string;
  fundType: string | null;
  etfType: string | null;
}): boolean {
  if (row.etfType === 'QDII' || row.fundType === '债券型' || row.fundType === '货币型') {
    return true;
  }
  return /黄金|商品期货/.test(row.name);
}

/** Refresh ETF metadata across listed, pending, and delisted statuses. */
export async function syncEtfBasic(client: TushareClient): Promise<number> {
  const [etfRows, fundRows] = await Promise.all([etfBasic(client), fundBasic(client)]);
  const fundByCode = new Map(fundRows.map((row) => [row.ts_code, row]));
  const data = etfRows.map((row) => {
    const fund = fundByCode.get(row.ts_code);
    const name = row.extname || row.csname || fund?.name || row.ts_code;
    const fundType = fund?.fund_type ?? null;
    const etfType = row.etf_type ?? null;

    return {
      tsCode: row.ts_code,
      name,
      fullName: row.cname,
      indexCode: row.index_code,
      indexName: row.index_name,
      setupDate: row.setup_date,
      listDate: row.list_date,
      delistDate: fund?.delist_date ?? null,
      listStatus: row.list_status,
      exchange: row.exchange,
      managerName: row.mgr_name,
      custodianName: row.custod_name,
      managementFee: row.mgt_fee,
      fundType,
      etfType,
      sameDayTurnover: supportsSameDayTurnover({ name, fundType, etfType }),
      lotSize: 100,
    };
  });

  await prisma.$transaction([prisma.etfBasic.deleteMany({}), prisma.etfBasic.createMany({ data })]);
  log(`etf_basic stored ${data.length} instruments (all listing statuses)`);
  return data.length;
}

interface DateSlice {
  start: TradeDate;
  end: TradeDate;
}

function yearlySlices(start: TradeDate, end: TradeDate): DateSlice[] {
  const slices: DateSlice[] = [];
  for (let year = Number(start.slice(0, 4)); year <= Number(end.slice(0, 4)); year++) {
    slices.push({
      start: (year === Number(start.slice(0, 4)) ? start : `${year}0101`) as TradeDate,
      end: (year === Number(end.slice(0, 4)) ? end : `${year}1231`) as TradeDate,
    });
  }
  return slices;
}

/**
 * Sync selected ETF daily bars and adjustment factors in atomic code/year slices.
 * Completion markers make a long backfill resumable; pass refresh to refetch completed slices.
 */
export async function syncEtfDaily(
  client: TushareClient,
  codes: string[],
  start: TradeDate,
  end: TradeDate,
  options: { refresh?: boolean } = {},
): Promise<{ daily: number; adj: number; skippedSlices: number }> {
  const uniqueCodes = [...new Set(codes)].sort();
  const known = await prisma.etfBasic.findMany({
    where: { tsCode: { in: uniqueCodes } },
    select: { tsCode: true },
  });
  const knownCodes = new Set(known.map((row) => row.tsCode));
  const unknownCodes = uniqueCodes.filter((code) => !knownCodes.has(code));
  if (unknownCodes.length > 0) {
    throw new Error(`Unknown ETF code(s): ${unknownCodes.join(', ')}`);
  }

  let dailyCount = 0;
  let adjCount = 0;
  let skippedSlices = 0;
  const slices = yearlySlices(start, end);

  for (const code of uniqueCodes) {
    for (const slice of slices) {
      if (!options.refresh) {
        const completed = await prisma.etfSyncSlice.findUnique({
          where: {
            tsCode_startDate_endDate: {
              tsCode: code,
              startDate: slice.start,
              endDate: slice.end,
            },
          },
          select: { tsCode: true },
        });
        if (completed) {
          skippedSlices++;
          continue;
        }
      }

      const [dailyRows, adjRows] = await Promise.all([
        fundDaily(client, {
          ts_code: code,
          start_date: slice.start,
          end_date: slice.end,
        }),
        fundAdj(client, {
          ts_code: code,
          start_date: slice.start,
          end_date: slice.end,
        }),
      ]);
      await prisma.$transaction([
        prisma.etfDaily.deleteMany({
          where: { tsCode: code, tradeDate: { gte: slice.start, lte: slice.end } },
        }),
        prisma.etfDaily.createMany({
          data: dailyRows.map((row) => ({
            tsCode: row.ts_code,
            tradeDate: row.trade_date,
            open: row.open,
            high: row.high,
            low: row.low,
            close: row.close,
            preClose: row.pre_close,
            pctChg: row.pct_chg,
            vol: row.vol,
            amount: row.amount,
          })),
        }),
        prisma.etfAdjFactor.deleteMany({
          where: { tsCode: code, tradeDate: { gte: slice.start, lte: slice.end } },
        }),
        prisma.etfAdjFactor.createMany({
          data: adjRows.map((row) => ({
            tsCode: row.ts_code,
            tradeDate: row.trade_date,
            adjFactor: row.adj_factor,
          })),
        }),
        prisma.etfSyncSlice.upsert({
          where: {
            tsCode_startDate_endDate: {
              tsCode: code,
              startDate: slice.start,
              endDate: slice.end,
            },
          },
          create: { tsCode: code, startDate: slice.start, endDate: slice.end },
          update: { completedAt: new Date() },
        }),
      ]);
      dailyCount += dailyRows.length;
      adjCount += adjRows.length;
      log(
        `  ${code} ${slice.start}~${slice.end}: daily ${dailyRows.length}, adj ${adjRows.length}`,
      );
    }
  }

  log(
    `syncEtfDaily complete: daily ${dailyCount}, adj ${adjCount}, skipped slices ${skippedSlices}`,
  );
  return { daily: dailyCount, adj: adjCount, skippedSlices };
}
