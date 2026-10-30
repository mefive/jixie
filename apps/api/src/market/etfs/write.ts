import { z } from 'zod';
import type {
  MarketPartition,
  MarketTransaction,
  PreparedTable,
  AcceptedMarketPartition,
  PreparedMarketPartition,
} from '../synchronization/partition.js';
import { collectWriteResult, emptyWriteResult, mergeRows } from '../synchronization/rows.js';

const etfBasicSchema = z.strictObject({
  tsCode: z.string(),
  name: z.string(),
  fullName: z.string().nullish(),
  indexCode: z.string().nullish(),
  indexName: z.string().nullish(),
  setupDate: z.string().nullish(),
  listDate: z.string().nullish(),
  delistDate: z.string().nullish(),
  listStatus: z.string(),
  exchange: z.string(),
  managerName: z.string().nullish(),
  custodianName: z.string().nullish(),
  managementFee: z.number().finite().nullish(),
  fundType: z.string().nullish(),
  etfType: z.string().nullish(),
  sameDayTurnover: z.boolean(),
  lotSize: z.number().int().optional(),
});

const etfDailySchema = z.strictObject({
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

const etfAdjFactorSchema = z.strictObject({
  tsCode: z.string(),
  tradeDate: z.string(),
  adjFactor: z.number().finite(),
});

/**
 * 显式写入本领域的表，校验与数据变化随调用者事务提交。
 *
 * Write this domain's declared tables within the caller's transaction.
 */
export async function writeEtfPartition(
  transaction: MarketTransaction,
  prepared: PreparedMarketPartition,
  partition: MarketPartition,
) {
  const result = emptyWriteResult();

  for (const batch of prepared.tables) {
    switch (batch.table) {
      case 'EtfBasic':
        await writeEtfBasic(transaction, batch, result);
        break;
      case 'EtfDaily':
        await writeEtfDaily(transaction, batch, prepared, partition, result);
        break;
      case 'EtfAdjFactor':
        await writeEtfAdjFactor(transaction, batch, prepared, partition, result);
        break;
      default:
        throw new Error(`Unexpected etfs table ${batch.table}`);
    }
  }

  return result;
}

/**
 * 写入 EtfBasic 的业务记录。
 *
 * Persist typed EtfBasic records.
 */
async function writeEtfBasic(
  transaction: MarketTransaction,
  batch: PreparedTable,
  result: AcceptedMarketPartition,
) {
  const existing = await transaction.etfBasic.findMany({ where: {} });
  const rows = mergeRows({
    schema: etfBasicSchema,
    keys: ['tsCode'],
    records: batch.records,
    existing,
    replace: false,
    atomic: batch.atomic,
  });

  for (const row of rows.updated) {
    await transaction.etfBasic.update({ where: { tsCode: row.tsCode }, data: row });
  }
  if (rows.inserted.length) {
    await transaction.etfBasic.createMany({ data: rows.inserted });
  }
  collectWriteResult(result, rows);
}

/**
 * 写入 EtfDaily 的业务记录。
 *
 * Persist typed EtfDaily records.
 */
async function writeEtfDaily(
  transaction: MarketTransaction,
  batch: PreparedTable,
  prepared: PreparedMarketPartition,
  partition: MarketPartition,
  result: AcceptedMarketPartition,
) {
  const existing = await transaction.etfDaily.findMany({
    where: {
      tsCode: partition.scope,
      tradeDate: { gte: partition.startDate, lte: partition.endDate },
    },
  });
  const rows = mergeRows({
    schema: etfDailySchema,
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
    await transaction.etfDaily.update({
      where: { tsCode_tradeDate: { tsCode: row.tsCode, tradeDate: row.tradeDate } },
      data: row,
    });
  }
  if (rows.inserted.length) {
    await transaction.etfDaily.createMany({ data: rows.inserted });
  }
  for (let offset = 0; offset < rows.deleted.length; offset += 200) {
    await transaction.etfDaily.deleteMany({
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
 * 写入 EtfAdjFactor 的业务记录。
 *
 * Persist typed EtfAdjFactor records.
 */
async function writeEtfAdjFactor(
  transaction: MarketTransaction,
  batch: PreparedTable,
  prepared: PreparedMarketPartition,
  partition: MarketPartition,
  result: AcceptedMarketPartition,
) {
  const existing = await transaction.etfAdjFactor.findMany({
    where: {
      tsCode: partition.scope,
      tradeDate: { gte: partition.startDate, lte: partition.endDate },
    },
  });
  const rows = mergeRows({
    schema: etfAdjFactorSchema,
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
    await transaction.etfAdjFactor.update({
      where: { tsCode_tradeDate: { tsCode: row.tsCode, tradeDate: row.tradeDate } },
      data: row,
    });
  }
  if (rows.inserted.length) {
    await transaction.etfAdjFactor.createMany({ data: rows.inserted });
  }
  for (let offset = 0; offset < rows.deleted.length; offset += 200) {
    await transaction.etfAdjFactor.deleteMany({
      where: {
        OR: rows.deleted
          .slice(offset, offset + 200)
          .map((row) => ({ tsCode: row.tsCode, tradeDate: row.tradeDate })),
      },
    });
  }
  collectWriteResult(result, rows);
}
