import { z } from 'zod';
import type {
  MarketPartition,
  MarketTransaction,
  PreparedMarketPartition,
} from '../synchronization/partition.js';
import { collectWriteResult, emptyWriteResult, mergeRows } from '../synchronization/rows.js';

const tradeCalSchema = z.strictObject({
  exchange: z.string(),
  calDate: z.string(),
  isOpen: z.number().int(),
  pretradeDate: z.string().nullish(),
});

/** 显式写入本领域的表，校验与数据变化随调用者事务提交。
 * Write this domain's declared tables within the caller's transaction. */
export async function writeCalendarPartition(
  transaction: MarketTransaction,
  prepared: PreparedMarketPartition,
  partition: MarketPartition,
) {
  const result = emptyWriteResult();

  for (const batch of prepared.tables) {
    switch (batch.table) {
      case 'TradeCal': {
        const existing = await transaction.tradeCal.findMany({
          where: {
            exchange: partition.scope,
            calDate: { gte: partition.startDate, lte: partition.endDate },
          },
        });
        const rows = mergeRows({
          schema: tradeCalSchema,
          keys: ['exchange', 'calDate'],
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
          await transaction.tradeCal.update({
            where: { exchange_calDate: { exchange: row.exchange, calDate: row.calDate } },
            data: row,
          });
        }
        if (rows.inserted.length) {
          await transaction.tradeCal.createMany({ data: rows.inserted });
        }
        for (let offset = 0; offset < rows.deleted.length; offset += 200) {
          await transaction.tradeCal.deleteMany({
            where: {
              OR: rows.deleted
                .slice(offset, offset + 200)
                .map((row) => ({ exchange: row.exchange, calDate: row.calDate })),
            },
          });
        }
        collectWriteResult(result, rows);
        break;
      }
      default:
        throw new Error(`Unexpected calendar table ${batch.table}`);
    }
  }

  return result;
}
