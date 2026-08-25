import type { TradeDate } from '@jixie/shared';
import { prisma } from '../lib/prisma.js';
import {
  etfShareSize,
  fundAdj,
  fundDaily,
  type EtfShareSizeRow,
  type FundAdjRow,
  type FundDailyRow,
} from '../tushare/api.js';
import type { TushareClient } from '../tushare/client.js';
import { log } from '../util/log.js';

const FUND_ADJ_PAGE_SIZE = 2_000;

export interface EtfMarketDateSyncSummary {
  tradeDate: TradeDate;
  availableDate: TradeDate;
  requestedCodes: number;
  activeCodes: number;
  daily: number;
  adjustment: number;
  shareSize: number;
  missingDailyCodes: string[];
}

export interface EtfShareSizeDateSyncSummary {
  tradeDate: TradeDate;
  availableDate: TradeDate;
  requestedCodes: number;
  activeCodes: number;
  shareSize: number;
  missingCodes: string[];
}

export interface EtfShareSizeRangeSyncSummary {
  startDate: TradeDate;
  endDate: TradeDate;
  completedDates: number;
  skippedDates: number;
  incompleteDates: number;
  missingObservations: number;
  rows: number;
}

export interface EtfRevisionRefreshSummary {
  dates: number;
  earliestChangedDate: string | null;
  dailyRows: number;
  adjustmentRows: number;
  shareSizeRows: number;
}

/** Fetch every fund_adj page for one date and reject a provider that ignores pagination. */
export async function fetchAllFundAdjForDate(
  client: TushareClient,
  tradeDate: TradeDate,
): Promise<FundAdjRow[]> {
  const rows: FundAdjRow[] = [];
  const seen = new Set<string>();

  for (let offset = 0; ; offset += FUND_ADJ_PAGE_SIZE) {
    const page = await fundAdj(client, {
      trade_date: tradeDate,
      offset,
      limit: FUND_ADJ_PAGE_SIZE,
    });
    let newRows = 0;
    for (const row of page) {
      const key = `${row.ts_code}|${row.trade_date}`;
      if (!seen.has(key)) {
        rows.push(row);
        seen.add(key);
        newRows++;
      }
    }
    if (page.length < FUND_ADJ_PAGE_SIZE) {
      return rows;
    }
    if (newRows === 0) {
      throw new Error(`fund_adj pagination returned no new rows at offset ${offset}`);
    }
  }
}

/** Atomically replace daily price, adjustment, and share-size slices for selected ETF products. */
export async function syncEtfMarketDate(
  client: TushareClient,
  tradeDate: TradeDate,
  requestedCodes: readonly string[],
): Promise<EtfMarketDateSyncSummary> {
  const activeCodes = await activeEtfCodesOnDate(requestedCodes, tradeDate);
  if (activeCodes.length === 0) {
    throw new Error(`No requested ETF is active on ${tradeDate}`);
  }

  const [dailyCandidate, adjustmentCandidate, shareSizeCandidate, availableDate] =
    await Promise.all([
      fundDaily(client, { trade_date: tradeDate }),
      fetchAllFundAdjForDate(client, tradeDate),
      etfShareSize(client, { trade_date: tradeDate }),
      nextSseTradingDate(tradeDate),
    ]);
  const activeCodeSet = new Set(activeCodes);
  const dailyRows = validateAndFilterRows(dailyCandidate, activeCodeSet, tradeDate, 'fund_daily');
  const adjustmentRows = validateAndFilterRows(
    adjustmentCandidate,
    activeCodeSet,
    tradeDate,
    'fund_adj',
  );
  const shareSizeRows = validateAndFilterRows(
    shareSizeCandidate,
    activeCodeSet,
    tradeDate,
    'etf_share_size',
  );
  assertCompleteCoverage(activeCodes, adjustmentRows, 'fund_adj', tradeDate);
  assertCompleteCoverage(activeCodes, shareSizeRows, 'etf_share_size', tradeDate);
  const missingDailyCodes = missingCoverage(activeCodes, dailyRows);
  assertTolerableDailyGaps(activeCodes, missingDailyCodes, tradeDate);

  await publishEtfMarketDate(
    tradeDate,
    availableDate,
    activeCodes,
    dailyRows,
    adjustmentRows,
    shareSizeRows,
  );
  const summary = {
    tradeDate,
    availableDate,
    requestedCodes: new Set(requestedCodes).size,
    activeCodes: activeCodes.length,
    daily: dailyRows.length,
    adjustment: adjustmentRows.length,
    shareSize: shareSizeRows.length,
    missingDailyCodes,
  };
  log(
    `ETF market ${tradeDate}: ${summary.daily} daily, ${summary.adjustment} adjustment, ${summary.shareSize} share-size rows, ${summary.missingDailyCodes.length} no-bar products; available ${availableDate}`,
  );
  return summary;
}

/** Atomically replace only the share-size slice, used by bounded historical backfills. */
export async function syncEtfShareSizeDate(
  client: TushareClient,
  tradeDate: TradeDate,
  requestedCodes: readonly string[],
  options: { strictCoverage?: boolean } = {},
): Promise<EtfShareSizeDateSyncSummary> {
  const activeCodes = await activeEtfCodesOnDate(requestedCodes, tradeDate);
  const availableDate = await nextSseTradingDate(tradeDate);
  if (activeCodes.length === 0) {
    return {
      tradeDate,
      availableDate,
      requestedCodes: new Set(requestedCodes).size,
      activeCodes: 0,
      shareSize: 0,
      missingCodes: [],
    };
  }

  const candidate = await etfShareSize(client, { trade_date: tradeDate });
  const activeCodeSet = new Set(activeCodes);
  const rows = validateAndFilterRows(candidate, activeCodeSet, tradeDate, 'etf_share_size');
  const missingCodes = missingCoverage(activeCodes, rows);
  if (options.strictCoverage !== false) {
    assertCompleteCoverage(activeCodes, rows, 'etf_share_size', tradeDate);
  }
  await prisma.$transaction(async (database) => {
    await database.etfShareSize.deleteMany({
      where: { tsCode: { in: activeCodes }, tradeDate },
    });
    if (rows.length > 0) {
      await database.etfShareSize.createMany({
        data: rows.map((row) => shareSizeData(row, availableDate)),
      });
    }
  });
  return {
    tradeDate,
    availableDate,
    requestedCodes: new Set(requestedCodes).size,
    activeCodes: activeCodes.length,
    shareSize: rows.length,
    missingCodes,
  };
}

/** Backfill open-date share-size slices with date-level resumption based on atomic row counts. */
export async function syncEtfShareSizeRange(
  client: TushareClient,
  startDate: TradeDate,
  endDate: TradeDate,
  requestedCodes: readonly string[],
  options: { refresh?: boolean } = {},
): Promise<EtfShareSizeRangeSyncSummary> {
  const dates = await prisma.tradeCal.findMany({
    where: {
      exchange: 'SSE',
      isOpen: 1,
      calDate: { gte: startDate, lte: endDate },
    },
    orderBy: { calDate: 'asc' },
    select: { calDate: true },
  });
  const summary: EtfShareSizeRangeSyncSummary = {
    startDate,
    endDate,
    completedDates: 0,
    skippedDates: 0,
    incompleteDates: 0,
    missingObservations: 0,
    rows: 0,
  };

  for (const row of dates) {
    const tradeDate = row.calDate as TradeDate;
    const activeCodes = await activeEtfCodesOnDate(requestedCodes, tradeDate);
    if (!options.refresh) {
      const existingRows = await prisma.etfShareSize.count({
        where: { tsCode: { in: activeCodes }, tradeDate },
      });
      if (existingRows > 0 || activeCodes.length === 0) {
        summary.skippedDates++;
        continue;
      }
    }

    const result = await syncEtfShareSizeDate(client, tradeDate, requestedCodes, {
      strictCoverage: false,
    });
    summary.completedDates++;
    if (result.missingCodes.length > 0) {
      summary.incompleteDates++;
      summary.missingObservations += result.missingCodes.length;
    }
    summary.rows += result.shareSize;
    log(
      `  ETF share size ${tradeDate}: ${result.shareSize}/${result.activeCodes} rows, missing ${result.missingCodes.length}, available ${result.availableDate}`,
    );
  }
  return summary;
}

/** Refresh bounded date slices and report the earliest semantic provider revision. */
export async function refreshEtfRegistryRevisions(
  client: TushareClient,
  tradeDates: readonly TradeDate[],
  requestedCodes: readonly string[],
): Promise<EtfRevisionRefreshSummary> {
  if (tradeDates.length === 0) {
    return {
      dates: 0,
      earliestChangedDate: null,
      dailyRows: 0,
      adjustmentRows: 0,
      shareSizeRows: 0,
    };
  }
  const sortedDates = [...new Set(tradeDates)].sort();
  const startDate = sortedDates[0];
  const endDate = sortedDates.at(-1)!;
  const before = await loadEtfRevisionSnapshot(requestedCodes, startDate, endDate);
  let dailyRows = 0;
  let adjustmentRows = 0;
  let shareSizeRows = 0;

  for (const tradeDate of sortedDates) {
    const summary = await syncEtfMarketDate(client, tradeDate, requestedCodes);
    dailyRows += summary.daily;
    adjustmentRows += summary.adjustment;
    shareSizeRows += summary.shareSize;
  }
  const after = await loadEtfRevisionSnapshot(requestedCodes, startDate, endDate);
  return {
    dates: sortedDates.length,
    earliestChangedDate: earliestSnapshotChange(before, after),
    dailyRows,
    adjustmentRows,
    shareSizeRows,
  };
}

async function publishEtfMarketDate(
  tradeDate: TradeDate,
  availableDate: TradeDate,
  activeCodes: string[],
  dailyRows: FundDailyRow[],
  adjustmentRows: FundAdjRow[],
  shareSizeRows: EtfShareSizeRow[],
): Promise<void> {
  await prisma.$transaction(async (database) => {
    await database.etfDaily.deleteMany({
      where: { tsCode: { in: activeCodes }, tradeDate },
    });
    await database.etfDaily.createMany({
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
    });
    await database.etfAdjFactor.deleteMany({
      where: { tsCode: { in: activeCodes }, tradeDate },
    });
    await database.etfAdjFactor.createMany({
      data: adjustmentRows.map((row) => ({
        tsCode: row.ts_code,
        tradeDate: row.trade_date,
        adjFactor: row.adj_factor,
      })),
    });
    await database.etfShareSize.deleteMany({
      where: { tsCode: { in: activeCodes }, tradeDate },
    });
    await database.etfShareSize.createMany({
      data: shareSizeRows.map((row) => shareSizeData(row, availableDate)),
    });
  });
}

async function activeEtfCodesOnDate(
  requestedCodes: readonly string[],
  tradeDate: TradeDate,
): Promise<string[]> {
  const uniqueCodes = [...new Set(requestedCodes)].sort();
  const metadata = await prisma.etfBasic.findMany({
    where: { tsCode: { in: uniqueCodes } },
    select: { tsCode: true, listDate: true, delistDate: true },
  });
  const metadataByCode = new Map(metadata.map((row) => [row.tsCode, row]));
  const unknownCodes = uniqueCodes.filter((code) => !metadataByCode.has(code));
  if (unknownCodes.length > 0) {
    throw new Error(`Unknown ETF code(s): ${unknownCodes.join(', ')}`);
  }

  return uniqueCodes.filter((code) => {
    const row = metadataByCode.get(code)!;
    return (
      row.listDate != null &&
      row.listDate <= tradeDate &&
      (row.delistDate == null || row.delistDate >= tradeDate)
    );
  });
}

async function nextSseTradingDate(tradeDate: TradeDate): Promise<TradeDate> {
  const row = await prisma.tradeCal.findFirst({
    where: { exchange: 'SSE', isOpen: 1, calDate: { gt: tradeDate } },
    orderBy: { calDate: 'asc' },
    select: { calDate: true },
  });
  if (!row) {
    throw new Error(
      `TradeCal has no SSE session after ${tradeDate}; sync a calendar buffer before ETF data`,
    );
  }
  return row.calDate as TradeDate;
}

function validateAndFilterRows<Row extends { ts_code: string; trade_date: string }>(
  rows: Row[],
  activeCodes: ReadonlySet<string>,
  tradeDate: TradeDate,
  source: string,
): Row[] {
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.trade_date !== tradeDate) {
      throw new Error(`${source} returned ${row.trade_date} while syncing ${tradeDate}`);
    }
    const key = `${row.ts_code}|${row.trade_date}`;
    if (seen.has(key)) {
      throw new Error(`${source} returned duplicate row ${key}`);
    }
    seen.add(key);
  }
  return rows.filter((row) => activeCodes.has(row.ts_code));
}

function assertCompleteCoverage<Row extends { ts_code: string }>(
  activeCodes: string[],
  rows: Row[],
  source: string,
  tradeDate: TradeDate,
): void {
  const missingCodes = missingCoverage(activeCodes, rows);
  if (missingCodes.length > 0) {
    throw new Error(`${source} missing ETF code(s) on ${tradeDate}: ${missingCodes.join(', ')}`);
  }
}

function assertTolerableDailyGaps(
  activeCodes: string[],
  missingDailyCodes: string[],
  tradeDate: TradeDate,
): void {
  // fund_adj and etf_share_size are still mandatory for every active product. A small number of
  // products can legitimately have no fund_daily bar while suspended or without a trade. A broad
  // gap is treated as a truncated/failed provider response and blocks publication.
  const maximumNoBarProducts = Math.max(2, Math.ceil(activeCodes.length * 0.05));
  if (missingDailyCodes.length > maximumNoBarProducts) {
    throw new Error(
      `fund_daily missing ${missingDailyCodes.length}/${activeCodes.length} ETF code(s) on ${tradeDate}: ${missingDailyCodes.join(', ')}`,
    );
  }
}

function missingCoverage<Row extends { ts_code: string }>(
  activeCodes: string[],
  rows: Row[],
): string[] {
  const observedCodes = new Set(rows.map((row) => row.ts_code));
  return activeCodes.filter((code) => !observedCodes.has(code));
}

function shareSizeData(row: EtfShareSizeRow, availableDate: TradeDate) {
  return {
    tsCode: row.ts_code,
    tradeDate: row.trade_date,
    availableDate,
    totalShare: row.total_share,
    totalSize: row.total_size,
    nav: row.nav,
    close: row.close,
    exchange: row.exchange,
  };
}

async function loadEtfRevisionSnapshot(
  requestedCodes: readonly string[],
  startDate: TradeDate,
  endDate: TradeDate,
): Promise<Map<string, string>> {
  const codes = [...new Set(requestedCodes)];
  const [dailyRows, adjustmentRows, shareSizeRows] = await Promise.all([
    prisma.etfDaily.findMany({
      where: { tsCode: { in: codes }, tradeDate: { gte: startDate, lte: endDate } },
      orderBy: [{ tradeDate: 'asc' }, { tsCode: 'asc' }],
    }),
    prisma.etfAdjFactor.findMany({
      where: { tsCode: { in: codes }, tradeDate: { gte: startDate, lte: endDate } },
      orderBy: [{ tradeDate: 'asc' }, { tsCode: 'asc' }],
    }),
    prisma.etfShareSize.findMany({
      where: { tsCode: { in: codes }, tradeDate: { gte: startDate, lte: endDate } },
      orderBy: [{ tradeDate: 'asc' }, { tsCode: 'asc' }],
      select: {
        tsCode: true,
        tradeDate: true,
        availableDate: true,
        totalShare: true,
        totalSize: true,
        nav: true,
        close: true,
        exchange: true,
      },
    }),
  ]);
  const snapshot = new Map<string, string>();
  for (const row of dailyRows) {
    snapshot.set(`daily|${row.tradeDate}|${row.tsCode}`, JSON.stringify(row));
  }
  for (const row of adjustmentRows) {
    snapshot.set(`adjustment|${row.tradeDate}|${row.tsCode}`, JSON.stringify(row));
  }
  for (const row of shareSizeRows) {
    snapshot.set(`share-size|${row.tradeDate}|${row.tsCode}`, JSON.stringify(row));
  }
  return snapshot;
}

function earliestSnapshotChange(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): string | null {
  const changedDates: string[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(key) !== after.get(key)) {
      changedDates.push(key.split('|')[1]);
    }
  }
  return changedDates.sort()[0] ?? null;
}
