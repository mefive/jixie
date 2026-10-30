import { getDatabase } from '#infra/database/prisma.js';
import { STOCK_CODE_CHANGES } from './stock-identity.js';

/**
 * 幂等保存已确认代码接续。
 *
 * Seed confirmed code successions idempotently.
 */
export async function seedStockCodeChanges(): Promise<number> {
  await getDatabase().$transaction(
    STOCK_CODE_CHANGES.map((change) =>
      getDatabase().stockCodeChange.upsert({
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
