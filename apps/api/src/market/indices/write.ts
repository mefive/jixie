import { z } from 'zod';
import type {
  MarketPartition,
  MarketTransaction,
  PreparedTable,
  AcceptedMarketPartition,
  PreparedMarketPartition,
} from '../synchronization/partition.js';
import { collectWriteResult, emptyWriteResult, mergeRows } from '../synchronization/rows.js';

const indexWeightSchema = z.strictObject({
  indexCode: z.string(),
  conCode: z.string(),
  tradeDate: z.string(),
  weight: z.number().finite().nullish(),
});

const indexDailySchema = z.strictObject({
  tsCode: z.string(),
  tradeDate: z.string(),
  close: z.number().finite(),
});

const indexDailyBasicSchema = z.strictObject({
  tsCode: z.string(),
  tradeDate: z.string(),
  totalMv: z.number().finite().nullish(),
  floatMv: z.number().finite().nullish(),
  totalShare: z.number().finite().nullish(),
  floatShare: z.number().finite().nullish(),
  freeShare: z.number().finite().nullish(),
  turnoverRate: z.number().finite().nullish(),
  turnoverRateF: z.number().finite().nullish(),
  pe: z.number().finite().nullish(),
  peTtm: z.number().finite().nullish(),
  pb: z.number().finite().nullish(),
});

/**
 * 显式写入本领域的表，校验与数据变化随调用者事务提交。
 *
 * Write this domain's declared tables within the caller's transaction.
 */
export async function writeIndexPartition(
  transaction: MarketTransaction,
  prepared: PreparedMarketPartition,
  partition: MarketPartition,
) {
  const result = emptyWriteResult();

  for (const batch of prepared.tables) {
    switch (batch.table) {
      case 'IndexWeight':
        await writeIndexWeight(transaction, batch, prepared, partition, result);
        break;
      case 'IndexDaily':
        await writeIndexDaily(transaction, batch, prepared, partition, result);
        break;
      case 'IndexDailyBasic':
        await writeIndexDailyBasic(transaction, batch, prepared, partition, result);
        break;
      default:
        throw new Error(`Unexpected indices table ${batch.table}`);
    }
  }

  return result;
}

/**
 * 写入 IndexWeight 的业务记录。
 *
 * Persist typed IndexWeight records.
 */
async function writeIndexWeight(
  transaction: MarketTransaction,
  batch: PreparedTable,
  prepared: PreparedMarketPartition,
  partition: MarketPartition,
  result: AcceptedMarketPartition,
) {
  const existing = await transaction.indexWeight.findMany({
    where: {
      indexCode: partition.scope,
      tradeDate: String(batch.records[0]?.values.tradeDate ?? ''),
    },
  });
  const rows = mergeRows({
    schema: indexWeightSchema,
    keys: ['indexCode', 'conCode', 'tradeDate'],
    records: batch.records,
    existing,
    replace:
      batch.replace &&
      ((prepared.status === 'complete' && !prepared.errors.length) ||
        (batch.atomic === true && prepared.checks.terminalPage && !prepared.checks.sourceFailed)),
    atomic: batch.atomic,
  });

  for (const row of rows.updated) {
    await transaction.indexWeight.update({
      where: {
        indexCode_conCode_tradeDate: {
          indexCode: row.indexCode,
          conCode: row.conCode,
          tradeDate: row.tradeDate,
        },
      },
      data: row,
    });
  }
  if (rows.inserted.length) {
    await transaction.indexWeight.createMany({ data: rows.inserted });
  }
  for (let offset = 0; offset < rows.deleted.length; offset += 200) {
    await transaction.indexWeight.deleteMany({
      where: {
        OR: rows.deleted.slice(offset, offset + 200).map((row) => ({
          indexCode: row.indexCode,
          conCode: row.conCode,
          tradeDate: row.tradeDate,
        })),
      },
    });
  }
  collectWriteResult(result, rows);
}

/**
 * 写入 IndexDaily 的业务记录。
 *
 * Persist typed IndexDaily records.
 */
async function writeIndexDaily(
  transaction: MarketTransaction,
  batch: PreparedTable,
  prepared: PreparedMarketPartition,
  partition: MarketPartition,
  result: AcceptedMarketPartition,
) {
  const existing = await transaction.indexDaily.findMany({
    where: {
      tsCode: partition.scope,
      tradeDate: { gte: partition.startDate, lte: partition.endDate },
    },
  });
  const rows = mergeRows({
    schema: indexDailySchema,
    keys: ['tsCode', 'tradeDate'],
    records: batch.records,
    existing,
    replace:
      batch.replace &&
      ((prepared.status === 'complete' && !prepared.errors.length) ||
        (batch.atomic === true && prepared.checks.terminalPage && !prepared.checks.sourceFailed)),
    atomic: batch.atomic,
  });

  for (const row of rows.updated) {
    await transaction.indexDaily.update({
      where: { tsCode_tradeDate: { tsCode: row.tsCode, tradeDate: row.tradeDate } },
      data: row,
    });
  }
  if (rows.inserted.length) {
    await transaction.indexDaily.createMany({ data: rows.inserted });
  }
  for (let offset = 0; offset < rows.deleted.length; offset += 200) {
    await transaction.indexDaily.deleteMany({
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
 * 写入 IndexDailyBasic 的业务记录。
 *
 * Persist typed IndexDailyBasic records.
 */
async function writeIndexDailyBasic(
  transaction: MarketTransaction,
  batch: PreparedTable,
  prepared: PreparedMarketPartition,
  partition: MarketPartition,
  result: AcceptedMarketPartition,
) {
  const existing = await transaction.indexDailyBasic.findMany({
    where: {
      tsCode: partition.scope,
      tradeDate: { gte: partition.startDate, lte: partition.endDate },
    },
  });
  const rows = mergeRows({
    schema: indexDailyBasicSchema,
    keys: ['tsCode', 'tradeDate'],
    records: batch.records,
    existing,
    replace:
      batch.replace &&
      ((prepared.status === 'complete' && !prepared.errors.length) ||
        (batch.atomic === true && prepared.checks.terminalPage && !prepared.checks.sourceFailed)),
    atomic: batch.atomic,
  });

  for (const row of rows.updated) {
    await transaction.indexDailyBasic.update({
      where: { tsCode_tradeDate: { tsCode: row.tsCode, tradeDate: row.tradeDate } },
      data: row,
    });
  }
  if (rows.inserted.length) {
    await transaction.indexDailyBasic.createMany({ data: rows.inserted });
  }
  for (let offset = 0; offset < rows.deleted.length; offset += 200) {
    await transaction.indexDailyBasic.deleteMany({
      where: {
        OR: rows.deleted
          .slice(offset, offset + 200)
          .map((row) => ({ tsCode: row.tsCode, tradeDate: row.tradeDate })),
      },
    });
  }
  collectWriteResult(result, rows);
}
