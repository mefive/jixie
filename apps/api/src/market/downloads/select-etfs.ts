import { getDatabase } from '#infra/database/prisma.js';
import { z } from 'zod';
import type { MarketTransaction } from '../synchronization/partition.js';
import {
  withMaintenanceLock,
  withMarketPublication,
  assertMaintenanceOwner,
} from '#infra/coordination/market-access.js';
import { prepareEtfPartition } from '../etfs/sync-partition.js';
import { writeEtfPartition } from '../etfs/write.js';
import { fetchSourcePages, sourceString, type SyncSource } from '../synchronization/source.js';
import { calendarDay, localDate, isObservationDate } from '../synchronization/date.js';
import { MarketSourcePendingError } from '../errors.js';
import { recordImportIssue } from '../synchronization/diagnostics.js';

export interface SelectEtfsInput {
  source: SyncSource;
  limit?: number;
  today?: string;
}

interface EtfSizeSnapshot {
  date: string;
  pages: number;
  rows: Array<{ tsCode: string; tradeDate: string; totalSize: number | null }>;
}

interface EtfSelectionCatalog {
  tsCode: string;
  listStatus: string;
  listDate: string | null;
  delistDate: string | null;
}

export interface HistoricalEtfSelectionInput {
  source: SyncSource;
  date: string;
  limit?: number;
  exchanges?: readonly string[];
}

/**
 * 只读取指定历史交易日的完整规模快照；缺席不回退到今天或其他日期。
 *
 * Read one complete historical size snapshot without substituting today's or another day's data.
 */
export async function fetchEtfSizes(source: SyncSource, date: string): Promise<EtfSizeSnapshot> {
  if (!isObservationDate(date)) {
    throw new Error('Invalid ETF size date');
  }
  const pages = await fetchSourcePages(
    source,
    'etf_share_size',
    { trade_date: date },
    'ts_code,trade_date,total_size',
    5000,
  );
  if (!pages.complete || pages.errors.length) {
    throw new MarketSourcePendingError(`Incomplete ETF size snapshot: ${pages.errors.join('; ')}`);
  }
  const codes = new Set<string>();
  const rows = pages.rows.map((row) => {
    const tsCode = typeof row.ts_code === 'string' ? row.ts_code : '';
    const totalSize = row.total_size;
    const invalidIdentity =
      row.trade_date !== date || !/^\d{6}\.(SH|SZ)$/.test(tsCode) || codes.has(tsCode);
    const invalidSize =
      totalSize != null &&
      (typeof totalSize !== 'number' || !Number.isFinite(totalSize) || totalSize < 0);
    if (invalidIdentity || invalidSize) {
      const message = `Invalid ETF size snapshot record ${tsCode}/${date}`;
      recordImportIssue({
        category: 'snapshot',
        reasonCode: 'invalid_etf_size_snapshot',
        message,
        businessKey: { tsCode, tradeDate: date },
        payload: row,
      });
      throw new Error(message);
    }
    codes.add(tsCode);

    return { tsCode, tradeDate: date, totalSize: typeof totalSize === 'number' ? totalSize : null };
  });

  return { date, rows, pages: pages.pages };
}

/**
 * 按历史时点判断上市范围；今天已退市的基金仍可参加退市前的排名。
 *
 * Evaluate listing membership at the snapshot date, including funds delisted since then.
 */
function rankEtfs(
  snapshot: EtfSizeSnapshot,
  catalog: readonly EtfSelectionCatalog[],
  limit: number,
) {
  const listed = new Set(
    catalog
      .filter(
        (row) =>
          isObservationDate(row.listDate) &&
          row.listDate <= snapshot.date &&
          (row.listStatus === 'L' ||
            (row.listStatus === 'D' && isObservationDate(row.delistDate))) &&
          (!row.delistDate || row.delistDate >= snapshot.date),
      )
      .map((row) => row.tsCode),
  );
  const ranked = snapshot.rows
    .filter((row) => listed.has(row.tsCode) && row.totalSize !== null && row.totalSize > 0)
    .sort(
      (left, right) =>
        right.totalSize! - left.totalSize! || left.tsCode.localeCompare(right.tsCode),
    );
  const sized = new Set(ranked.map((row) => row.tsCode));

  return {
    selectedCodes: ranked.slice(0, limit).map((row) => row.tsCode),
    missingSizeCodes: [...listed].filter((code) => !sized.has(code)).sort(),
  };
}

/**
 * 本交易日最多选 N 只；不足 N 或完整空响应是正常来源事实。
 *
 * Select up to N funds for this session; fewer than N or a complete empty response is valid.
 */
export async function prepareHistoricalEtfSelection(input: HistoricalEtfSelectionInput) {
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000) {
    throw new Error('ETF selection requires a limit from 1 to 5000');
  }
  const snapshot = await fetchEtfSizes(input.source, input.date);
  const catalog = await getDatabase().etfBasic.findMany({
    where: {
      listDate: { lte: input.date },
      ...(input.exchanges
        ? {
            exchange: {
              in: input.exchanges.flatMap((exchange) =>
                exchange === 'SSE' ? ['SH'] : exchange === 'SZSE' ? ['SZ'] : [],
              ),
            },
          }
        : {}),
    },
    select: { tsCode: true, listDate: true, delistDate: true, listStatus: true },
  });
  const ranked = rankEtfs(snapshot, catalog, limit);

  return {
    date: snapshot.date,
    receivedCount: snapshot.rows.length,
    pages: snapshot.pages,
    ...ranked,
  };
}

/**
 * 取得完整分页的最近已发布同日快照；不混合日期、不用份额代替规模。
 *
 * Fetch the latest fully paginated single-date snapshot without mixing dates or ranking units as size.
 */
export async function fetchLatestSizes(source: SyncSource, today: string) {
  const calendar = await fetchSourcePages(
    source,
    'trade_cal',
    {
      exchange: 'SSE',
      start_date: calendarDay(today, -14),
      end_date: calendarDay(today, -1),
    },
    'cal_date,is_open',
  );
  if (!calendar.complete || calendar.errors.length) {
    throw new MarketSourcePendingError(`Incomplete calendar: ${calendar.errors.join('; ')}`);
  }
  const dates = calendar.rows
    .filter((row) => row.is_open === 1)
    .map((row) => sourceString(row, 'cal_date'))
    .sort()
    .reverse();

  for (const date of dates) {
    if (!isObservationDate(date) || date >= today) {
      throw new Error('Invalid source calendar date');
    }
    const snapshot = await fetchEtfSizes(source, date);
    if (!snapshot.rows.length) {
      continue;
    }

    return snapshot;
  }

  throw new MarketSourcePendingError(
    'No published ETF size snapshot in the last fourteen calendar days',
  );
}

/**
 * 显式选取与已有名单取并集；任何下载或校验失败保留原名单。
 *
 * Merge explicit selections atomically; fetch or validation failures preserve saved lists.
 */
export async function selectEtfsUnderMaintenance(input: SelectEtfsInput) {
  assertMaintenanceOwner();
  const limit = input.limit ?? 100;
  const today = input.today ?? localDate(new Date());
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000 || !isObservationDate(today)) {
    throw new Error('ETF selection requires a limit from 1 to 5000 and a valid date');
  }

  const prepared = await prepareEtfPartition(input.source, {
    dataset: 'etf-master',
    scope: 'all',
    startDate: '19901219',
    endDate: today,
  });
  if (prepared.status !== 'complete' || prepared.errors.length) {
    throw new MarketSourcePendingError(`Incomplete ETF catalog: ${prepared.errors.join('; ')}`);
  }
  const catalog = prepared.tables.flatMap((table) => table.records.map((record) => record.values));
  const catalogCodes = catalog.map((row) => String(row.tsCode));
  if (!catalog.length || new Set(catalogCodes).size !== catalog.length) {
    throw new Error('Empty or duplicate ETF catalog');
  }
  const snapshot = await fetchLatestSizes(input.source, today);
  const { selectedCodes, missingSizeCodes } = rankEtfs(
    snapshot,
    catalog.map((row) => ({
      tsCode: String(row.tsCode),
      listStatus: String(row.listStatus),
      listDate: typeof row.listDate === 'string' ? row.listDate : null,
      delistDate: typeof row.delistDate === 'string' ? row.delistDate : null,
    })),
    limit,
  );
  const database = getDatabase();
  let codes: string[] = [];

  await withMarketPublication(() =>
    database.$transaction(
      async (transaction) => {
        const accepted = await writeEtfPartition(transaction, prepared, {
          dataset: 'etf-master',
          scope: 'all',
          startDate: '19901219',
          endDate: today,
        });
        if (accepted.errors.length) {
          throw new Error(`ETF catalog rejected: ${accepted.errors.join('; ')}`);
        }
        codes = await mergeEtfSelection(transaction, selectedCodes);
        await transaction.marketDataState.upsert({
          where: { key: 'global' },
          create: { key: 'global', revision: 1 },
          update: { revision: { increment: 1 } },
        });
      },
      { timeout: 120_000 },
    ),
  );

  return {
    date: snapshot.date,
    catalogCount: catalog.length,
    selectedCodes,
    codes,
    missingSizeCodes,
  };
}

/**
 * 名单与调用者的批次收据同事务提交；重复选择不改变已保存名单。
 *
 * Commit the union with the caller's batch receipt; repeated selections leave saved lists unchanged.
 */
export async function mergeEtfSelection(
  transaction: MarketTransaction,
  selectedCodes: readonly string[],
): Promise<string[]> {
  const existing = await transaction.ingestionSelection.findUnique({ where: { assetType: 'etf' } });
  const current = existing ? z.array(z.string()).parse(existing.codes) : [];
  const codes = [...new Set([...current, ...selectedCodes])].sort();
  if (!existing || JSON.stringify(current) !== JSON.stringify(codes)) {
    await transaction.ingestionSelection.upsert({
      where: { assetType: 'etf' },
      create: { assetType: 'etf', codes },
      update: { codes },
    });
  }

  return codes;
}

/** 管理员可额外选取当期 Top N，已有历史入选者继续保留。
 * Administrators may add a current top N while retaining earlier historical selections. */
export async function selectTopEtfs(input: SelectEtfsInput) {
  return withMaintenanceLock(() => selectEtfsUnderMaintenance(input));
}
