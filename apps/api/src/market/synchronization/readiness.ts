import type { Prisma } from '@prisma/client';
import { getDatabase } from '#infra/database/prisma.js';
import { MarketError } from '../errors.js';

export interface InputRequirement {
  dataset: string;
  scope?: string;
  startDate: string;
  endDate: string;
}
export interface InputReadiness {
  ready: boolean;
  gaps: string[];
}

/**
 * 读取实际业务数据判断指定输入是否存在，不查询采集控制表或全市场完成资格。
 *
 * Inspect requested business inputs directly, without ingestion receipts or market-wide eligibility.
 */
type InputDatabase = Pick<
  Prisma.TransactionClient,
  | 'daily'
  | 'adjFactor'
  | 'dailyBasic'
  | 'stkLimit'
  | 'etfDaily'
  | 'etfAdjFactor'
  | 'indexDaily'
  | 'indexDailyBasic'
  | 'indexWeight'
  | 'tradeCal'
  | 'stockBasic'
  | 'etfBasic'
>;

export async function datasetInputReadiness(
  requirements: InputRequirement[],
  database: InputDatabase = getDatabase(),
): Promise<InputReadiness> {
  const gaps: string[] = [];
  for (const requirement of requirements) {
    const tradeDate = { gte: requirement.startDate, lte: requirement.endDate };
    const tsCode = requirement.scope && requirement.scope !== 'all' ? requirement.scope : undefined;
    const where = { tradeDate, ...(tsCode ? { tsCode } : {}) };
    let found: unknown;
    switch (requirement.dataset) {
      case 'stock-prices':
        found = await database.daily.findFirst({ where });
        break;
      case 'stock-adjustments':
        found = await database.adjFactor.findFirst({ where });
        break;
      case 'stock-valuations':
        found = await database.dailyBasic.findFirst({ where });
        break;
      case 'stock-limits':
        found = await database.stkLimit.findFirst({ where });
        break;
      case 'etf-prices':
        found = await database.etfDaily.findFirst({ where });
        break;
      case 'etf-adjustments':
        found = await database.etfAdjFactor.findFirst({ where });
        break;
      case 'index-prices':
        found = await database.indexDaily.findFirst({ where });
        break;
      case 'index-valuations':
        found = await database.indexDailyBasic.findFirst({ where });
        break;
      case 'index-weights':
        found = await database.indexWeight.findFirst({
          where: { tradeDate, ...(tsCode ? { indexCode: tsCode } : {}) },
        });
        break;
      case 'calendar':
        found = await database.tradeCal.findFirst({
          where: { calDate: tradeDate, exchange: requirement.scope ?? 'SSE' },
        });
        break;
      case 'stock-master':
        found = await database.stockBasic.findFirst();
        break;
      case 'etf-master':
        found = await database.etfBasic.findFirst();
        break;
      default:
        found = null;
    }
    if (!found) {
      gaps.push(
        `${requirement.dataset}/${requirement.scope ?? 'all'}: no saved input in ${requirement.startDate}..${requirement.endDate}`,
      );
    }
  }

  return { ready: !gaps.length, gaps };
}

export async function assertDatasetInputReadiness(
  requirements: InputRequirement[],
  database?: InputDatabase,
): Promise<void> {
  const result = await datasetInputReadiness(requirements, database);
  if (!result.ready) {
    throw new MarketError('inputs_not_ready', { details: { gaps: result.gaps } });
  }
}

/**
 * 稀疏价格保持稀疏；实际返回的每条价格必须有对应复权因子。
 *
 * Preserve sparse prices; require an adjustment only for each actual returned price.
 */
export async function assertPriceSeriesReadiness(
  assetType: 'stock' | 'etf' | 'index',
  code: string,
  startDate: string,
  endDate: string,
): Promise<void> {
  if (assetType === 'index' || startDate > endDate) {
    return;
  }
  const database = getDatabase();
  const where = { tsCode: code, tradeDate: { gte: startDate, lte: endDate } };
  const [prices, adjustments] =
    assetType === 'stock'
      ? await Promise.all([
          database.daily.findMany({ where, select: { tradeDate: true } }),
          database.adjFactor.findMany({ where, select: { tradeDate: true, adjFactor: true } }),
        ])
      : await Promise.all([
          database.etfDaily.findMany({ where, select: { tradeDate: true } }),
          database.etfAdjFactor.findMany({ where, select: { tradeDate: true, adjFactor: true } }),
        ]);
  const adjusted = new Set(
    adjustments.filter((row) => row.adjFactor > 0).map((row) => row.tradeDate),
  );
  const missing = prices.filter((row) => !adjusted.has(row.tradeDate)).map((row) => row.tradeDate);
  if (missing.length) {
    throw new MarketError('inputs_not_ready', {
      details: { gaps: [`${code}: missing adjustments on ${missing.join(', ')}`] },
    });
  }
}

export async function marketRevision(): Promise<number> {
  return (
    (await getDatabase().marketDataState.findUnique({ where: { key: 'global' } }))?.revision ?? 0
  );
}
