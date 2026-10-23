import type { MarketIndicator, IndexIndicator, IndustryIndicator } from '@prisma/client';
import type { DerivedMarketScope } from './scope.js';
import { getDatabase } from '#infra/database/prisma.js';
import { datasetInputReadiness } from '../synchronization/readiness.js';

export type MarketMetricGroup =
  | 'trend'
  | 'breadth'
  | 'activity'
  | 'amount'
  | 'valuation'
  | 'limits';
export const MARKET_CALCULATION_VERSION = 'market-state-sync-v2';
export const MARKET_AUDIT_VERSION = 'market-eligibility-v3';

export const MARKET_METRIC_GROUPS: MarketMetricGroup[] = [
  'trend',
  'breadth',
  'activity',
  'amount',
  'valuation',
  'limits',
];

/**
 * 市场统计和模型资格不再承担原始记录入库门禁。
 *
 * Statistical and model eligibility no longer gates ingestion of independent valid records.
 */
export async function marketMetricReadiness(
  tradeDate: string,
): Promise<Record<MarketMetricGroup, string[]>> {
  const output: Record<MarketMetricGroup, string[]> = {
    trend: [],
    breadth: [],
    activity: [],
    amount: [],
    valuation: [],
    limits: [],
  };
  const session = await getDatabase().tradeCal.findUnique({
    where: { exchange_calDate: { exchange: 'SSE', calDate: tradeDate } },
  });
  if (session?.isOpen === 0) {
    return output;
  }
  const [prices, adjustments, basics, limits, sessions] = await Promise.all([
    getDatabase().daily.findMany({
      where: { tradeDate },
      select: { tsCode: true, close: true, pctChg: true, amount: true },
    }),
    getDatabase().adjFactor.findMany({
      where: { tradeDate },
      select: { tsCode: true, adjFactor: true },
    }),
    getDatabase().dailyBasic.findMany({
      where: { tradeDate },
      select: { tsCode: true, circMv: true, turnoverRate: true, turnoverRateF: true },
    }),
    getDatabase().stkLimit.findMany({ where: { tradeDate }, select: { tsCode: true } }),
    getDatabase().tradeCal.findMany({
      where: { exchange: 'SSE', isOpen: 1, calDate: { lte: tradeDate } },
      orderBy: { calDate: 'desc' },
      take: 60,
      select: { calDate: true },
    }),
  ]);
  const source = await datasetInputReadiness([
    { dataset: 'stock-prices', scope: 'all', startDate: tradeDate, endDate: tradeDate },
  ]);
  if (!source.ready || !prices.length) {
    for (const group of MARKET_METRIC_GROUPS) {
      output[group].push(
        ...source.gaps,
        ...(!prices.length ? ['No valid same-day price cross-section'] : []),
      );
    }
  }
  const codes = new Set(prices.map((price) => price.tsCode));
  const missing = (rows: { tsCode: string }[]) =>
    prices.length - rows.filter((row) => codes.has(row.tsCode)).length;
  if (missing(adjustments) || adjustments.some((row) => row.adjFactor <= 0)) {
    output.trend.push('Adjusted-price sample is incomplete');
  }
  if (sessions.length < 60) {
    output.trend.push('Fewer than 60 actual calendar observations');
  } else {
    const history = await datasetInputReadiness([
      {
        dataset: 'stock-prices',
        scope: 'all',
        startDate: sessions.at(-1)!.calDate,
        endDate: tradeDate,
      },
      {
        dataset: 'stock-adjustments',
        scope: 'all',
        startDate: sessions.at(-1)!.calDate,
        endDate: tradeDate,
      },
    ]);
    output.trend.push(...history.gaps);
  }
  if (prices.some((row) => row.pctChg == null)) {
    output.breadth.push('Missing same-day returns');
  }
  if (prices.some((row) => row.amount == null)) {
    output.amount.push('Missing exact-day amounts');
  }
  const activityInputs = new Map(basics.map((row) => [row.tsCode, row]));
  const missingActivity = prices.filter((price) => {
    const basic = activityInputs.get(price.tsCode);
    const turnover = basic?.turnoverRateF ?? basic?.turnoverRate;

    return (
      basic?.circMv == null ||
      !Number.isFinite(basic.circMv) ||
      basic.circMv <= 0 ||
      turnover == null ||
      !Number.isFinite(turnover) ||
      turnover < 0
    );
  });
  if (missingActivity.length) {
    output.activity.push(
      `Missing valid float capitalization or turnover for ${missingActivity.length}/${prices.length} traded securities`,
    );
  }
  if (missing(basics)) {
    output.valuation.push('Valuation cross-section is incomplete');
  }
  if (missing(limits)) {
    output.limits.push('Price-limit cross-section is incomplete');
  }
  for (const [group, dataset] of [
    ['trend', 'stock-adjustments'],
    ['activity', 'stock-valuations'],
    ['valuation', 'stock-valuations'],
    ['limits', 'stock-limits'],
  ] as const) {
    const status = await datasetInputReadiness([
      { dataset, scope: 'all', startDate: tradeDate, endDate: tradeDate },
    ]);
    output[group].push(...status.gaps);
  }

  return output;
}

const METRIC_GROUP_BY_FIELD: Readonly<
  Record<string, 'trend' | 'breadth' | 'activity' | 'amount' | 'valuation' | 'limits'>
> = {
  limitUpCount: 'limits',
  limitDownCount: 'limits',
  peTtm: 'valuation',
  pb: 'valuation',
  valuationCoverage: 'valuation',
  totalAmount: 'amount',
  topFivePercentAmountShare: 'amount',
  amountShare: 'amount',
  topFiveAmountShare: 'amount',
  floatWeightedTurnoverRate: 'activity',
  advanceRatio: 'breadth',
  extremeMoveRatio: 'breadth',
  return20: 'trend',
  excessReturn20: 'trend',
  positiveReturn20Ratio: 'trend',
  aboveMa20Ratio: 'trend',
  aboveMa60Ratio: 'trend',
};

export interface MarketIndicatorOutputs {
  market: MarketIndicator | null;
  indices: IndexIndicator[];
  industries: IndustryIndicator[];
}
export type MarketMetricGaps = Record<MarketMetricGroup, string[]>;

/**
 * 指标的字段分组与缺项解释由 Market 统一维护，消费者不自行重建样本口径。
 *
 * Market owns metric-field groups and missing-input interpretation for every consumer.
 */
export function maskMarketMetrics<Row extends object>(row: Row, groups: MarketMetricGaps): Row {
  return Object.fromEntries(
    Object.entries(row).map(([field, value]) => {
      const group = METRIC_GROUP_BY_FIELD[field];

      return [field, group && groups[group].length ? null : value];
    }),
  ) as Row;
}

export async function qualifyMarketOutputs(
  outputs: MarketIndicatorOutputs,
  scope: DerivedMarketScope,
  groups: MarketMetricGaps,
) {
  const qualifiedScopes: string[] = [];
  const gaps = Object.entries(groups).flatMap(([group, reasons]) =>
    reasons.map((reason) => `${group}: ${reason}`),
  );
  const baseGaps = new Set(Object.values(groups).flat());
  const qualify = <Row extends object>(row: Row, key: string, proof: boolean) => {
    const rowGroups = structuredClone(groups);
    if (!proof) {
      for (const reasons of Object.values(rowGroups)) {
        reasons.push('No complete membership snapshot proof');
      }
    }
    gaps.push(
      ...Object.entries(rowGroups).flatMap(([group, reasons]) =>
        reasons
          .filter((reason) => !baseGaps.has(reason))
          .map((reason) => `${key}/${group}: ${reason}`),
      ),
    );
    qualifiedScopes.push(key);

    return maskMarketMetrics(row, rowGroups);
  };
  const indices: IndexIndicator[] = [];
  for (const row of outputs.indices.filter((entry) => scope.indexCodes.includes(entry.indexCode))) {
    const membership = await getDatabase().indexWeight.findFirst({
      where: { indexCode: row.indexCode, tradeDate: { lte: row.tradeDate } },
      orderBy: { tradeDate: 'desc' },
    });
    const proof =
      membership &&
      (await getDatabase().datasetSyncPartition.findFirst({
        where: {
          dataset: 'index-weights',
          scope: row.indexCode,
          startDate: { lte: membership.tradeDate },
          endDate: { gte: membership.tradeDate },
          status: 'complete',
        },
      }));
    const qualified = qualify(row, `index:${row.indexCode}`, Boolean(proof));
    const returnGaps = await indexReturnReadiness(row.indexCode, row.tradeDate);
    if (returnGaps.length) {
      qualified.return20 = null;
      gaps.push(...returnGaps.map((reason) => `index:${row.indexCode}/return20: ${reason}`));
    }
    indices.push(qualified);
  }
  const industries: IndustryIndicator[] = [];
  for (const row of scope.industries ? outputs.industries : []) {
    const proof = await getDatabase().datasetSyncPartition.findFirst({
      where: { dataset: 'industry-members', scope: row.l1Code, status: 'complete' },
    });
    industries.push(qualify(row, `industry:${row.l1Code}`, Boolean(proof)));
  }
  const market = scope.market && outputs.market ? qualify(outputs.market, 'market', true) : null;

  return { outputs: { market, indices, industries }, groups, gaps, qualifiedScopes };
}

/**
 * 指数自身的二十期收益需要二十一个精确交易日价格，不借用股票截面的历史证明。
 *
 * An index's twenty-session return requires its own prices on all twenty-one exact sessions.
 */
async function indexReturnReadiness(indexCode: string, tradeDate: string): Promise<string[]> {
  const database = getDatabase();
  const sessions = await database.tradeCal.findMany({
    where: { exchange: 'SSE', isOpen: 1, calDate: { lte: tradeDate } },
    orderBy: { calDate: 'desc' },
    take: 21,
  });
  if (sessions.length !== 21 || sessions[0]?.calDate !== tradeDate) {
    return ['Fewer than 21 exact index calendar sessions'];
  }

  const startDate = sessions.at(-1)!.calDate;
  const proof = await datasetInputReadiness([
    { dataset: 'calendar', scope: 'SSE', startDate, endDate: tradeDate },
    { dataset: 'index-prices', scope: indexCode, startDate, endDate: tradeDate },
  ]);
  const prices = await database.indexDaily.findMany({
    where: { tsCode: indexCode, tradeDate: { in: sessions.map((session) => session.calDate) } },
    select: { tradeDate: true, close: true },
  });
  const valid = new Set(prices.filter((price) => price.close > 0).map((price) => price.tradeDate));
  const missing = sessions.filter((session) => !valid.has(session.calDate));

  return [
    ...proof.gaps,
    ...missing.map((session) => `Missing valid index price on ${session.calDate}`),
  ];
}

export const MARKET_INDICATOR_INPUT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  Daily: ['tsCode', 'tradeDate', 'close', 'pctChg', 'amount'],
  AdjFactor: ['tsCode', 'tradeDate', 'adjFactor'],
  DailyBasic: ['tsCode', 'tradeDate', 'circMv', 'turnoverRate', 'turnoverRateF', 'peTtm', 'pb'],
  StkLimit: ['tsCode', 'tradeDate', 'upLimit', 'downLimit'],
  IndexDaily: ['tsCode', 'tradeDate', 'close'],
  IndexWeight: ['indexCode', 'conCode', 'tradeDate', 'weight'],
  SwIndustryMember: ['tsCode', 'l1Code', 'l1Name', 'inDate', 'outDate'],
  TradeCal: ['exchange', 'calDate', 'isOpen'],
};
