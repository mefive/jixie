import { mergeStockSource } from '../instruments/source-selection.js';
import { changedListingIntervals } from '../synchronization/catalog-coverage.js';
import { stockCoverageIntervals } from '../instruments/market-range.js';
import { canonicalStockCode } from '../instruments/stock-identity.js';
import { isOutsideStockLimitScope } from './limit-scope.js';
import { z } from 'zod';
import type {
  MarketPartition,
  MarketTransaction,
  PreparedTable,
  AcceptedMarketPartition,
  PreparedMarketPartition,
} from '../synchronization/partition.js';
import { collectWriteResult, emptyWriteResult, mergeRows } from '../synchronization/rows.js';

const stockBasicSchema = z.strictObject({
  tsCode: z.string(),
  symbol: z.string(),
  name: z.string(),
  area: z.string().nullish(),
  market: z.string().nullish(),
  exchange: z
    .string()
    .refine((value) => ['SSE', 'SZSE', 'BSE'].includes(value))
    .nullish(),
  listDate: z.string().nullish(),
  delistDate: z.string().nullish(),
  listStatus: z.string(),
});

const stockNameHistorySchema = z.strictObject({
  sourceTsCode: z.string().nullish(),
  tsCode: z.string(),
  name: z.string(),
  startDate: z.string(),
  endDate: z.string().nullish(),
  announcementDate: z.string().nullish(),
  changeReason: z.string().nullish(),
});

const dailySchema = z.strictObject({
  sourceTsCode: z.string().nullish(),
  tsCode: z.string(),
  tradeDate: z.string(),
  open: z.number().finite().nullish(),
  high: z.number().finite().nullish(),
  low: z.number().finite().nullish(),
  close: z.number().finite().nullish(),
  preClose: z.number().finite().nullish(),
  pctChg: z.number().finite().nullish(),
  vol: z.number().finite().nullish(),
  amount: z.number().finite().nullish(),
});

const adjFactorSchema = z.strictObject({
  sourceTsCode: z.string().nullish(),
  tsCode: z.string(),
  tradeDate: z.string(),
  adjFactor: z.number().finite(),
});

const dailyBasicSchema = z.strictObject({
  sourceTsCode: z.string().nullish(),
  tsCode: z.string(),
  tradeDate: z.string(),
  pe: z.number().finite().nullish(),
  peTtm: z.number().finite().nullish(),
  pb: z.number().finite().nullish(),
  ps: z.number().finite().nullish(),
  psTtm: z.number().finite().nullish(),
  dvRatio: z.number().finite().nullish(),
  dvTtm: z.number().finite().nullish(),
  totalMv: z.number().finite().nullish(),
  circMv: z.number().finite().nullish(),
  turnoverRate: z.number().finite().nullish(),
  turnoverRateF: z.number().finite().nullish(),
});

const stkLimitSchema = z.strictObject({
  sourceTsCode: z.string().nullish(),
  tsCode: z.string(),
  tradeDate: z.string(),
  upLimit: z.number().finite(),
  downLimit: z.number().finite(),
});

/**
 * 显式写入本领域的表，校验与数据变化随调用者事务提交。
 *
 * Write this domain's declared tables within the caller's transaction.
 */
export async function writeStockPartition(
  transaction: MarketTransaction,
  prepared: PreparedMarketPartition,
  partition: MarketPartition,
) {
  const result = emptyWriteResult();

  for (const batch of prepared.tables) {
    switch (batch.table) {
      case 'StockBasic':
        await writeStockBasic(transaction, batch, result);
        break;
      case 'StockNameHistory':
        await writeStockNameHistory(transaction, batch, partition, result);
        break;
      case 'Daily':
        await writeDaily(transaction, batch, prepared, partition, result);
        break;
      case 'AdjFactor':
        await writeAdjFactor(transaction, batch, prepared, partition, result);
        break;
      case 'DailyBasic':
        await writeDailyBasic(transaction, batch, prepared, partition, result);
        break;
      case 'StkLimit':
        await writeStkLimit(transaction, batch, prepared, partition, result);
        break;
      default:
        throw new Error(`Unexpected stocks table ${batch.table}`);
    }
  }

  return result;
}

/**
 * 写入 StockBasic 的业务记录。
 *
 * Persist typed StockBasic records.
 */
async function writeStockBasic(
  transaction: MarketTransaction,
  batch: PreparedTable,
  result: AcceptedMarketPartition,
) {
  const existing = await transaction.stockBasic.findMany({ where: {} });
  const rows = mergeRows({
    schema: stockBasicSchema,
    keys: ['tsCode'],
    records: batch.records,
    existing,
    replace: false,
    atomic: batch.atomic,
  });

  for (const row of rows.updated) {
    await transaction.stockBasic.update({ where: { tsCode: row.tsCode }, data: row });
  }
  if (rows.inserted.length) {
    await transaction.stockBasic.createMany({ data: rows.inserted });
  }
  collectWriteResult(result, rows);

  const replacements = new Map([...rows.inserted, ...rows.updated].map((row) => [row.tsCode, row]));
  const before = stockCoverageIntervals(existing);
  const after = stockCoverageIntervals([
    ...existing.map((row) => replacements.get(row.tsCode) ?? row),
    ...rows.inserted,
  ]);
  result.coverageChanges = [];
  for (const code of new Set([...before.keys(), ...after.keys()])) {
    const changes = changedListingIntervals(before.get(code), after.get(code));
    for (const dates of changes) {
      for (const dataset of [
        'stock-prices',
        'stock-adjustments',
        'stock-valuations',
        'stock-limits',
      ]) {
        result.coverageChanges.push({ dataset, scope: 'all', ...dates });
      }
    }
  }
}

/**
 * 写入 StockNameHistory 的业务记录。
 *
 * Persist typed StockNameHistory records.
 */
async function writeStockNameHistory(
  transaction: MarketTransaction,
  batch: PreparedTable,
  partition: MarketPartition,
  result: AcceptedMarketPartition,
) {
  const existing = await transaction.stockNameHistory.findMany({ where: {} });
  const rows = mergeRows({
    schema: stockNameHistorySchema,
    merge: mergeStockSource,
    keys: ['tsCode', 'startDate'],
    records: batch.records,
    existing,
    replace: false,
    atomic: batch.atomic,
  });

  for (const row of rows.updated) {
    await transaction.stockNameHistory.update({
      where: { tsCode_startDate: { tsCode: row.tsCode, startDate: row.startDate } },
      data: row,
    });
  }
  if (rows.inserted.length) {
    await transaction.stockNameHistory.createMany({ data: rows.inserted });
  }
  if (batch.replace && !rows.errors.length) {
    const accepted = [
      ...rows.inserted,
      ...rows.updated,
      ...existing.filter((old) =>
        batch.records.some(
          (record) =>
            record.values.tsCode === old.tsCode && record.values.startDate === old.startDate,
        ),
      ),
    ];
    const acceptedKeys = new Set(
      accepted.map((row) => JSON.stringify([row.tsCode, row.startDate])),
    );
    const missing = existing.filter(
      (row) =>
        row.announcementDate &&
        row.announcementDate >= partition.startDate &&
        row.announcementDate <= partition.endDate &&
        !acceptedKeys.has(JSON.stringify([row.tsCode, row.startDate])),
    );
    for (let offset = 0; offset < missing.length; offset += 200) {
      const removed = await transaction.stockNameHistory.deleteMany({
        where: {
          OR: missing
            .slice(offset, offset + 200)
            .map((row) => ({ tsCode: row.tsCode, startDate: row.startDate })),
        },
      });
      result.deleted += removed.count;
      result.changed ||= removed.count > 0;
    }
  }
  collectWriteResult(result, rows);
}

/**
 * 写入 Daily 的业务记录。
 *
 * Persist typed Daily records.
 */
async function writeDaily(
  transaction: MarketTransaction,
  batch: PreparedTable,
  prepared: PreparedMarketPartition,
  partition: MarketPartition,
  result: AcceptedMarketPartition,
) {
  const existing = await transaction.daily.findMany({
    where: { tradeDate: partition.startDate },
  });
  const rows = mergeRows({
    schema: dailySchema,
    merge: mergeStockSource,
    keys: ['tsCode', 'tradeDate'],
    records: batch.records,
    existing,
    replace:
      batch.replace &&
      !prepared.checks.sourceAbsences &&
      ((prepared.status === 'complete' && !prepared.errors.length) ||
        (batch.atomic === true && prepared.checks.terminalPage && !prepared.checks.sourceFailed)),
    atomic: batch.atomic,
  });

  for (const row of rows.updated) {
    await transaction.daily.update({
      where: { tsCode_tradeDate: { tsCode: row.tsCode, tradeDate: row.tradeDate } },
      data: row,
    });
  }
  if (rows.inserted.length) {
    await transaction.daily.createMany({ data: rows.inserted });
  }
  for (let offset = 0; offset < rows.deleted.length; offset += 200) {
    await transaction.daily.deleteMany({
      where: {
        OR: rows.deleted
          .slice(offset, offset + 200)
          .map((row) => ({ tsCode: row.tsCode, tradeDate: row.tradeDate })),
      },
    });
  }
  collectWriteResult(result, rows);
}

/**
 * 写入 AdjFactor 的业务记录。
 *
 * Persist typed AdjFactor records.
 */
async function writeAdjFactor(
  transaction: MarketTransaction,
  batch: PreparedTable,
  prepared: PreparedMarketPartition,
  partition: MarketPartition,
  result: AcceptedMarketPartition,
) {
  const existing = await transaction.adjFactor.findMany({
    where: { tradeDate: partition.startDate },
  });
  const rows = mergeRows({
    schema: adjFactorSchema,
    merge: mergeStockSource,
    keys: ['tsCode', 'tradeDate'],
    records: batch.records,
    existing,
    replace:
      batch.replace &&
      !prepared.checks.sourceAbsences &&
      ((prepared.status === 'complete' && !prepared.errors.length) ||
        (batch.atomic === true && prepared.checks.terminalPage && !prepared.checks.sourceFailed)),
    atomic: batch.atomic,
  });

  for (const row of rows.updated) {
    await transaction.adjFactor.update({
      where: { tsCode_tradeDate: { tsCode: row.tsCode, tradeDate: row.tradeDate } },
      data: row,
    });
  }
  if (rows.inserted.length) {
    await transaction.adjFactor.createMany({ data: rows.inserted });
  }
  for (let offset = 0; offset < rows.deleted.length; offset += 200) {
    await transaction.adjFactor.deleteMany({
      where: {
        OR: rows.deleted
          .slice(offset, offset + 200)
          .map((row) => ({ tsCode: row.tsCode, tradeDate: row.tradeDate })),
      },
    });
  }
  collectWriteResult(result, rows);
}

/**
 * 写入 DailyBasic 的业务记录。
 *
 * Persist typed DailyBasic records.
 */
async function writeDailyBasic(
  transaction: MarketTransaction,
  batch: PreparedTable,
  prepared: PreparedMarketPartition,
  partition: MarketPartition,
  result: AcceptedMarketPartition,
) {
  const existing = await transaction.dailyBasic.findMany({
    where: { tradeDate: partition.startDate },
  });
  const rows = mergeRows({
    schema: dailyBasicSchema,
    merge: mergeStockSource,
    keys: ['tsCode', 'tradeDate'],
    records: batch.records,
    existing,
    replace:
      batch.replace &&
      !prepared.checks.sourceAbsences &&
      ((prepared.status === 'complete' && !prepared.errors.length) ||
        (batch.atomic === true && prepared.checks.terminalPage && !prepared.checks.sourceFailed)),
    atomic: batch.atomic,
  });

  for (const row of rows.updated) {
    await transaction.dailyBasic.update({
      where: { tsCode_tradeDate: { tsCode: row.tsCode, tradeDate: row.tradeDate } },
      data: row,
    });
  }
  if (rows.inserted.length) {
    await transaction.dailyBasic.createMany({ data: rows.inserted });
  }
  for (let offset = 0; offset < rows.deleted.length; offset += 200) {
    await transaction.dailyBasic.deleteMany({
      where: {
        OR: rows.deleted
          .slice(offset, offset + 200)
          .map((row) => ({ tsCode: row.tsCode, tradeDate: row.tradeDate })),
      },
    });
  }
  collectWriteResult(result, rows);
}

/**
 * 写入 StkLimit 的业务记录。
 *
 * Persist typed StkLimit records.
 */
async function writeStkLimit(
  transaction: MarketTransaction,
  batch: PreparedTable,
  prepared: PreparedMarketPartition,
  partition: MarketPartition,
  result: AcceptedMarketPartition,
) {
  const existing = await transaction.stkLimit.findMany({
    where: { tradeDate: partition.startDate },
  });
  const rows = mergeRows({
    schema: stkLimitSchema,
    merge: mergeStockSource,
    keys: ['tsCode', 'tradeDate'],
    records: batch.records,
    existing,
    replace: false,
    atomic: batch.atomic,
  });

  for (const row of rows.updated) {
    await transaction.stkLimit.update({
      where: { tsCode_tradeDate: { tsCode: row.tsCode, tradeDate: row.tradeDate } },
      data: row,
    });
  }
  if (rows.inserted.length) {
    await transaction.stkLimit.createMany({ data: rows.inserted });
  }
  collectWriteResult(result, rows);

  // 只在本次窗口完整核验后删除已确认范围外的旧限价；未知身份与缺席股票保留。
  // Remove only proven out-of-scope limits after this window verifies.
  // Retain unknown identities and absent stocks.
  if (
    !batch.replace ||
    prepared.status !== 'complete' ||
    !prepared.checks.terminalPage ||
    prepared.checks.sourceFailed ||
    prepared.errors.length ||
    rows.errors.length
  ) {
    return;
  }
  const [stockRows, fundRows] = await Promise.all([
    transaction.stockBasic.findMany({ select: { tsCode: true } }),
    transaction.etfBasic.findMany({ select: { tsCode: true } }),
  ]);
  const stocks = new Set(stockRows.map((row) => canonicalStockCode(row.tsCode)));
  const funds = new Set(fundRows.map((row) => row.tsCode));
  const outside = existing.filter((row) => isOutsideStockLimitScope(row.tsCode, stocks, funds));

  for (let offset = 0; offset < outside.length; offset += 200) {
    const removed = await transaction.stkLimit.deleteMany({
      where: {
        tradeDate: partition.startDate,
        tsCode: { in: outside.slice(offset, offset + 200).map((row) => row.tsCode) },
      },
    });
    result.deleted += removed.count;
    result.changed ||= removed.count > 0;
  }
  if (outside.length) {
    result.maxObservedDate = (
      await transaction.stkLimit.aggregate({ _max: { tradeDate: true } })
    )._max.tradeDate;
  }
}
