import { z } from 'zod';
import type {
  MarketPartition,
  MarketTransaction,
  PreparedMarketPartition,
} from '../synchronization/partition.js';
import { collectWriteResult, emptyWriteResult, mergeRows } from '../synchronization/rows.js';

const stockBasicSchema = z.strictObject({
  tsCode: z.string(),
  symbol: z.string(),
  name: z.string(),
  area: z.string().nullish(),
  market: z.string().nullish(),
  listDate: z.string().nullish(),
  delistDate: z.string().nullish(),
  listStatus: z.string(),
});

const stockNameHistorySchema = z.strictObject({
  tsCode: z.string(),
  name: z.string(),
  startDate: z.string(),
  endDate: z.string().nullish(),
  announcementDate: z.string().nullish(),
  changeReason: z.string().nullish(),
});

const dailySchema = z.strictObject({
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
  tsCode: z.string(),
  tradeDate: z.string(),
  adjFactor: z.number().finite(),
});

const dailyBasicSchema = z.strictObject({
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
  tsCode: z.string(),
  tradeDate: z.string(),
  upLimit: z.number().finite(),
  downLimit: z.number().finite(),
});

/** 显式写入本领域的表，校验与数据变化随调用者事务提交。
 * Write this domain's declared tables within the caller's transaction. */
export async function writeStockPartition(
  transaction: MarketTransaction,
  prepared: PreparedMarketPartition,
  partition: MarketPartition,
) {
  const result = emptyWriteResult();

  for (const batch of prepared.tables) {
    switch (batch.table) {
      case 'StockBasic': {
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
        break;
      }
      case 'StockNameHistory': {
        const existing = await transaction.stockNameHistory.findMany({ where: {} });
        const rows = mergeRows({
          schema: stockNameHistorySchema,
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
        break;
      }
      case 'Daily': {
        const existing = await transaction.daily.findMany({
          where: { tradeDate: partition.startDate },
        });
        const rows = mergeRows({
          schema: dailySchema,
          keys: ['tsCode', 'tradeDate'],
          records: batch.records,
          existing,
          replace:
            batch.replace &&
            ((prepared.status === 'complete' && !prepared.errors.length) ||
              (batch.atomic === true &&
                prepared.checks.terminalPage &&
                !prepared.checks.sourceFailed)),
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
        break;
      }
      case 'AdjFactor': {
        const existing = await transaction.adjFactor.findMany({
          where: { tradeDate: partition.startDate },
        });
        const rows = mergeRows({
          schema: adjFactorSchema,
          keys: ['tsCode', 'tradeDate'],
          records: batch.records,
          existing,
          replace:
            batch.replace &&
            ((prepared.status === 'complete' && !prepared.errors.length) ||
              (batch.atomic === true &&
                prepared.checks.terminalPage &&
                !prepared.checks.sourceFailed)),
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
        break;
      }
      case 'DailyBasic': {
        const existing = await transaction.dailyBasic.findMany({
          where: { tradeDate: partition.startDate },
        });
        const rows = mergeRows({
          schema: dailyBasicSchema,
          keys: ['tsCode', 'tradeDate'],
          records: batch.records,
          existing,
          replace:
            batch.replace &&
            ((prepared.status === 'complete' && !prepared.errors.length) ||
              (batch.atomic === true &&
                prepared.checks.terminalPage &&
                !prepared.checks.sourceFailed)),
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
        break;
      }
      case 'StkLimit': {
        const existing = await transaction.stkLimit.findMany({
          where: { tradeDate: partition.startDate },
        });
        const rows = mergeRows({
          schema: stkLimitSchema,
          keys: ['tsCode', 'tradeDate'],
          records: batch.records,
          existing,
          replace:
            batch.replace &&
            ((prepared.status === 'complete' && !prepared.errors.length) ||
              (batch.atomic === true &&
                prepared.checks.terminalPage &&
                !prepared.checks.sourceFailed)),
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
        for (let offset = 0; offset < rows.deleted.length; offset += 200) {
          await transaction.stkLimit.deleteMany({
            where: {
              OR: rows.deleted
                .slice(offset, offset + 200)
                .map((row) => ({ tsCode: row.tsCode, tradeDate: row.tradeDate })),
            },
          });
        }
        collectWriteResult(result, rows);
        break;
      }
      default:
        throw new Error(`Unexpected stocks table ${batch.table}`);
    }
  }

  return result;
}
