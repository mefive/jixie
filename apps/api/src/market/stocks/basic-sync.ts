import type { TradeDate } from '@jixie/shared';
import { day, daysBetween } from '#date';
import { prisma } from '#infra/database/prisma.js';
import { log } from '#infra/logging.js';
import {
  STOCK_CODE_CHANGES,
  canonicalStockCode,
  normalizeStockNameSpells,
} from '../instruments/stock-identity.js';
import { nameChange, stockBasic, type NameChangeRow } from '../providers/tushare/api.js';
import type { TushareClient } from '../providers/tushare/client.js';

const STOCK_LIST_STATUSES = ['L', 'D', 'P', 'G'] as const;
const TUSHARE_NAME_CHANGE_ROW_LIMIT = 10_000;

/** Sync the complete stock master. All upstream calls finish before the atomic replacement starts. */
export async function syncStockBasic(client: TushareClient): Promise<number> {
  const batches = await Promise.all(
    STOCK_LIST_STATUSES.map((listStatus) => stockBasic(client, { list_status: listStatus })),
  );
  const byCode = new Map(batches.flat().map((row) => [row.ts_code, row]));
  const rows = [...byCode.values()];

  await prisma.$transaction([
    prisma.stockBasic.deleteMany({}),
    prisma.stockBasic.createMany({
      data: rows.map((r) => ({
        tsCode: r.ts_code,
        symbol: r.symbol,
        name: r.name,
        area: r.area,
        industry: r.industry,
        market: r.market,
        listDate: r.list_date,
        delistDate: r.delist_date,
        listStatus: r.list_status,
      })),
    }),
  ]);
  log(
    `stock_basic stored ${rows.length} instruments (${STOCK_LIST_STATUSES.map(
      (status, index) => `${status}=${batches[index].length}`,
    ).join(', ')})`,
  );
  return rows.length;
}

/** Seed the small, exchange-confirmed code-succession registry idempotently. */
export async function seedStockCodeChanges(): Promise<number> {
  await prisma.$transaction(
    STOCK_CODE_CHANGES.map((change) =>
      prisma.stockCodeChange.upsert({
        where: { oldTsCode: change.oldTsCode },
        create: change,
        update: {
          newTsCode: change.newTsCode,
          effectiveDate: change.effectiveDate,
          source: change.source,
        },
      }),
    ),
  );
  return STOCK_CODE_CHANGES.length;
}

async function fetchNameChangeRange(
  client: TushareClient,
  start: TradeDate,
  end: TradeDate,
): Promise<NameChangeRow[]> {
  const rows = await nameChange(client, { start_date: start, end_date: end });
  if (rows.length < TUSHARE_NAME_CHANGE_ROW_LIMIT) {
    return rows;
  }
  if (start === end) {
    throw new Error(`namechange row limit reached for one day: ${start}`);
  }

  const middle = day(start)
    .add(Math.floor(daysBetween(start, end) / 2), 'day')
    .format('YYYYMMDD') as TradeDate;
  const next = day(middle).add(1, 'day').format('YYYYMMDD') as TradeDate;
  const [left, right] = await Promise.all([
    fetchNameChangeRange(client, start, middle),
    fetchNameChangeRange(client, next, end),
  ]);
  return left.concat(right);
}

/** Replace the small point-in-time name-spell table after a complete segmented upstream fetch. */
export async function syncStockNameHistory(
  client: TushareClient,
  start: TradeDate,
  end: TradeDate,
): Promise<number> {
  const rows = await fetchNameChangeRange(client, start, end);
  const fetchedSpells = rows.map((row) => ({
    tsCode: canonicalStockCode(row.ts_code),
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    announcementDate: row.ann_date,
    changeReason: row.change_reason,
  }));
  const data = normalizeStockNameSpells(fetchedSpells);
  const currentStocks = await prisma.stockBasic.findMany({
    where: { listStatus: 'L' },
    select: { tsCode: true, name: true, listDate: true },
  });
  const spellsByCode = new Map<string, typeof data>();
  for (const spell of data) {
    const existing = spellsByCode.get(spell.tsCode);
    if (existing) {
      existing.push(spell);
    } else {
      spellsByCode.set(spell.tsCode, [spell]);
    }
  }
  for (const stock of currentStocks) {
    const tsCode = canonicalStockCode(stock.tsCode);
    const spells = spellsByCode.get(tsCode) ?? [];
    if (spells.some((spell) => spell.endDate === null)) {
      continue;
    }
    const latest = [...spells].sort((left, right) =>
      right.startDate.localeCompare(left.startDate),
    )[0];
    const startDate =
      latest?.endDate != null
        ? (day(latest.endDate).add(1, 'day').format('YYYYMMDD') as TradeDate)
        : (stock.listDate ?? start);
    const fallback = {
      tsCode,
      name: stock.name,
      startDate,
      endDate: null,
      announcementDate: null,
      changeReason: 'StockBasic current-name fallback',
    };
    data.push(fallback);
    spells.push(fallback);
    spellsByCode.set(tsCode, spells);
  }

  await prisma.$transaction([
    prisma.stockNameHistory.deleteMany({}),
    prisma.stockNameHistory.createMany({ data }),
  ]);
  log(`stock name history stored ${data.length} spells`);
  return data.length;
}
