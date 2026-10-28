import { getDatabase } from '#infra/database/prisma.js';
import {
  withMaintenanceLock,
  withMarketPublication,
  assertMaintenanceOwner,
} from '#infra/coordination/market-access.js';
import { prepareEtfPartition } from '../etfs/sync-partition.js';
import { acceptMarketPartition } from '../synchronization/records.js';
import { fetchSourcePages, sourceString, type SyncSource } from '../synchronization/source.js';
import { calendarDay, localDate, isObservationDate } from '../synchronization/date.js';
import { MarketSourcePendingError } from '../errors.js';

export interface SelectEtfsInput {
  source: SyncSource;
  limit?: number;
  today?: string;
}

/**
 * 取得完整分页的最近已发布同日快照；不混合日期、不用份额代替规模。
 *
 * Fetch the latest fully paginated single-date snapshot without mixing dates or ranking units as size.
 */
async function fetchLatestSizes(source: SyncSource, today: string) {
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
    const pages = await fetchSourcePages(
      source,
      'etf_share_size',
      { trade_date: date },
      'ts_code,trade_date,total_size',
      5000,
    );
    if (!pages.complete || pages.errors.length) {
      throw new MarketSourcePendingError(
        `Incomplete ETF size snapshot: ${pages.errors.join('; ')}`,
      );
    }
    if (!pages.rows.length) {
      continue;
    }
    const codes = new Set<string>();
    const rows = pages.rows.map((row) => {
      const tsCode = sourceString(row, 'ts_code');
      if (row.trade_date !== date || !/^\d{6}\.(SH|SZ)$/.test(tsCode) || codes.has(tsCode)) {
        throw new Error('Invalid or duplicate ETF size identity/date');
      }
      codes.add(tsCode);
      const totalSize = row.total_size;
      if (
        totalSize != null &&
        (typeof totalSize !== 'number' || !Number.isFinite(totalSize) || totalSize < 0)
      ) {
        throw new Error(`Invalid ETF size ${tsCode}`);
      }

      return {
        tsCode,
        tradeDate: date,
        totalSize: typeof totalSize === 'number' ? totalSize : null,
      };
    });

    return { date, rows };
  }

  throw new MarketSourcePendingError(
    'No published ETF size snapshot in the last fourteen calendar days',
  );
}

/**
 * 已持维护锁的初始化与显式重选共用原子提交；任何下载或校验失败保留原名单。
 *
 * Initialize or explicitly reselect atomically under the writer lock; fetch/validation failures preserve saved lists.
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
    startDate: '20150101',
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
  const listed = catalog.filter(
    (row) =>
      row.listStatus === 'L' && typeof row.listDate === 'string' && row.listDate <= snapshot.date,
  );
  const listedCodes = new Set(listed.map((row) => String(row.tsCode)));
  const ranked = snapshot.rows
    .filter((row) => listedCodes.has(row.tsCode) && row.totalSize !== null && row.totalSize > 0)
    .sort(
      (left, right) =>
        right.totalSize! - left.totalSize! || left.tsCode.localeCompare(right.tsCode),
    );
  if (ranked.length < limit) {
    throw new MarketSourcePendingError(
      `Only ${ranked.length} listed ETFs have size on ${snapshot.date}; cannot select ${limit}`,
    );
  }
  const codes = ranked.slice(0, limit).map((row) => row.tsCode);
  const sizedCodes = new Set(ranked.map((row) => row.tsCode));
  const missingSizeCodes = [...listedCodes].filter((code) => !sizedCodes.has(code)).sort();
  const database = getDatabase();

  await withMarketPublication(() =>
    database.$transaction(
      async (transaction) => {
        const accepted = await acceptMarketPartition(
          transaction,
          prepared,
          'etf-master',
          new Date(),
        );
        if (accepted.errors.length) {
          throw new Error(`ETF catalog rejected: ${accepted.errors.join('; ')}`);
        }
        await transaction.etfLatestSize.deleteMany({});
        await transaction.etfLatestSize.createMany({ data: snapshot.rows });
        await transaction.marketDownloadList.upsert({
          where: { assetType: 'etf' },
          create: { assetType: 'etf', codes },
          update: { codes },
        });
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
    selectedCodes: codes,
    missingSizeCodes,
  };
}

/** 显式重选只通过管理员 CLI 发起，不由每天刷新覆盖人工名单。
 * Explicit reselection comes from the administrator CLI, never the daily refresh. */
export async function selectTopEtfs(input: SelectEtfsInput) {
  return withMaintenanceLock(() => selectEtfsUnderMaintenance(input));
}
