import { allMarketIndicatorScope, type DerivedMarketScope } from './scope.js';
import {
  createDatabase,
  closeDatabase,
  getDatabase,
  withDatabase,
} from '#infra/database/prisma.js';
import { createReadCopy } from '#infra/database/read-copy.js';
import { databaseFilename } from '#infra/coordination/market-access.js';
import { syncMarketIndicators } from './sync.js';
import {
  marketMetricReadiness,
  qualifyMarketOutputs,
  type MarketIndicatorOutputs,
} from './eligibility.js';
import type { Prisma } from '@prisma/client';

/**
 * 复用已测量的 SQL 计算，在私有文件计算，正式写事务只提交输出和 ready。
 *
 * Reuse measured SQL in a private calculation file; formal transactions publish only outputs and
 * readiness.
 */
export async function prepareMarketIndicators(
  tradeDate: string,
  scope: DerivedMarketScope = allMarketIndicatorScope(),
) {
  const groups = await marketMetricReadiness(tradeDate);
  const history = await getDatabase().tradeCal.findMany({
    where: { exchange: 'SSE', isOpen: 1, calDate: { lt: tradeDate } },
    orderBy: { calDate: 'desc' },
    take: 60,
    select: { calDate: true },
  });
  const startDate = history.at(-1)?.calDate ?? tradeDate;
  const daily = ['Daily', 'AdjFactor', 'DailyBasic', 'StkLimit', 'IndexDaily'];
  const memberships = await Promise.all(
    scope.indexCodes.map(async (indexCode) => ({
      indexCode,
      snapshot: await getDatabase().indexWeight.findFirst({
        where: { indexCode, tradeDate: { lte: tradeDate } },
        orderBy: { tradeDate: 'desc' },
        select: { tradeDate: true },
      }),
    })),
  );
  const weightSlices = memberships
    .filter((entry) => entry.snapshot)
    .map((entry) => ({
      name: 'IndexWeight',
      dateColumn: 'tradeDate',
      startDate: entry.snapshot!.tradeDate,
      endDate: entry.snapshot!.tradeDate,
      equals: { column: 'indexCode', value: entry.indexCode },
    }));
  const copy = await createReadCopy(databaseFilename(), [
    ...daily.map((name) => ({ name, dateColumn: 'tradeDate', startDate, endDate: tradeDate })),
    { name: 'TradeCal', dateColumn: 'calDate', startDate, endDate: tradeDate },
    ...(weightSlices.length
      ? weightSlices
      : [
          {
            name: 'IndexWeight',
            dateColumn: 'tradeDate',
            startDate: '00000000',
            endDate: '00000000',
          },
        ]),
    { name: 'SwIndustryMember', dateColumn: 'inDate', startDate: '00000000', endDate: tradeDate },
    ...['MarketIndicator', 'IndexIndicator', 'IndustryIndicator'].map((name) => ({
      name,
      dateColumn: 'tradeDate',
      startDate: tradeDate,
      endDate: tradeDate,
    })),
  ]);
  const database = createDatabase(`file:${copy.filename}`);
  let outputs: MarketIndicatorOutputs;
  try {
    outputs = await withDatabase(database, async () => {
      await syncMarketIndicators(tradeDate, tradeDate, scope);
      const [market, indices, industries] = await Promise.all([
        database.marketIndicator.findUnique({ where: { tradeDate } }),
        database.indexIndicator.findMany({ where: { tradeDate } }),
        database.industryIndicator.findMany({ where: { tradeDate } }),
      ]);

      return { market, indices, industries };
    });
  } finally {
    try {
      await closeDatabase(database);
    } finally {
      await copy.close();
    }
  }

  return qualifyMarketOutputs(outputs, scope, groups);
}

/**
 * 只发布本轮选择的指标对象；调用者把输出、版本核对与 ready 放在同一事务内。
 *
 * Publish only selected metric objects; the caller commits outputs, version checks and readiness
 * atomically.
 */
export async function publishMarketIndicators(
  transaction: Prisma.TransactionClient,
  tradeDate: string,
  scope: DerivedMarketScope,
  outputs: MarketIndicatorOutputs,
): Promise<void> {
  if (scope.market && !outputs.market) {
    await transaction.marketIndicator.deleteMany({ where: { tradeDate } });
  }
  if (scope.industries) {
    await transaction.industryIndicator.deleteMany({
      where: { tradeDate, l1Code: { notIn: outputs.industries.map((row) => row.l1Code) } },
    });
  }
  if (scope.indexCodes.length) {
    await transaction.indexIndicator.deleteMany({
      where: {
        tradeDate,
        indexCode: { in: scope.indexCodes, notIn: outputs.indices.map((row) => row.indexCode) },
      },
    });
  }

  if (scope.market && outputs.market) {
    await transaction.marketIndicator.upsert({
      where: { tradeDate },
      create: outputs.market,
      update: outputs.market,
    });
  }
  for (const row of outputs.indices) {
    await transaction.indexIndicator.upsert({
      where: { indexCode_tradeDate: { indexCode: row.indexCode, tradeDate } },
      create: row,
      update: row,
    });
  }
  for (const row of outputs.industries) {
    await transaction.industryIndicator.upsert({
      where: { l1Code_tradeDate: { l1Code: row.l1Code, tradeDate } },
      create: row,
      update: row,
    });
  }
}
