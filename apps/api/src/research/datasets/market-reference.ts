import { prisma } from '#infra/database/prisma.js';

/**
 * 指定受控参考数据的身份和日期范围。
 *
 * Request a governed reference dataset by identity and date range.
 */
export interface ResearchReferenceDatasetRequestV1 {
  identifier: string;
  start: string;
  end: string;
}

/**
 * 按来源行可用的首个后续中国交易日筛选 ETF 份额。
 *
 * ETF shares are gated by the first later China-market session on which the source row is usable.
 */
export async function loadResearchEtfShares(request: ResearchReferenceDatasetRequestV1) {
  const rows = await prisma.etfShareSize.findMany({
    where: {
      tsCode: request.identifier,
      availableDate: { gte: request.start, lte: request.end },
    },
    orderBy: [{ availableDate: 'asc' }, { tradeDate: 'asc' }],
  });
  return rows.map((row) => ({
    date: row.availableDate,
    trade_date: row.tradeDate,
    total_share_10k: row.totalShare,
    total_size_cny_10k: row.totalSize,
    nav: row.nav,
    close: row.close,
    exchange: row.exchange,
  }));
}

/**
 * 保留供应商官方指数估值方法，不从成分数据自行重建。
 *
 * Preserve the provider's official index-level methodology instead of reconstructing valuations.
 */
export async function loadResearchIndexValuation(request: ResearchReferenceDatasetRequestV1) {
  const rows = await prisma.indexDailyBasic.findMany({
    where: {
      tsCode: request.identifier,
      tradeDate: { gte: request.start, lte: request.end },
    },
    orderBy: { tradeDate: 'asc' },
  });
  return rows.map((row) => ({
    date: row.tradeDate,
    total_mv_cny: row.totalMv,
    float_mv_cny: row.floatMv,
    total_share: row.totalShare,
    float_share: row.floatShare,
    free_share: row.freeShare,
    turnover_rate_pct: row.turnoverRate,
    turnover_rate_free_float_pct: row.turnoverRateF,
    pe: row.pe,
    pe_ttm: row.peTtm,
    pb: row.pb,
  }));
}

/**
 * 按稳定代码或精确名称解析受治理申万一级行业后读取状态。
 *
 * Load one governed Shenwan level-1 industry by either its stable code or exact name.
 */
export async function loadResearchIndustryState(request: ResearchReferenceDatasetRequestV1) {
  const rows = await prisma.industryIndicator.findMany({
    where: {
      OR: [{ l1Code: request.identifier }, { l1Name: request.identifier }],
      tradeDate: { gte: request.start, lte: request.end },
    },
    orderBy: { tradeDate: 'asc' },
  });
  return rows.map((row) => ({
    date: row.tradeDate,
    industry_code: row.l1Code,
    industry_name: row.l1Name,
    traded_count: row.tradedCount,
    return_20d: row.return20,
    excess_return_20d: row.excessReturn20,
    positive_return_20d_ratio: row.positiveReturn20Ratio,
    above_ma20_ratio: row.aboveMa20Ratio,
    above_ma60_ratio: row.aboveMa60Ratio,
    float_weighted_turnover_rate_pct: row.floatWeightedTurnoverRate,
    amount_share: row.amountShare,
    top_five_amount_share: row.topFiveAmountShare,
  }));
}

/**
 * 只为实际交割合约读取交易所结算参数。
 *
 * Load exchange settlement parameters only for an actual delivery contract.
 */
export async function loadResearchFuturesSettlement(request: ResearchReferenceDatasetRequestV1) {
  const rows = await prisma.futureSettlement.findMany({
    where: {
      tsCode: request.identifier,
      tradeDate: { gte: request.start, lte: request.end },
    },
    orderBy: { tradeDate: 'asc' },
  });
  return rows.map((row) => ({
    date: row.tradeDate,
    settle: row.settle,
    trading_fee_rate: row.tradingFeeRate,
    trading_fee: row.tradingFee,
    delivery_fee: row.deliveryFee,
    buy_hedge_margin_rate_pct: row.buyHedgeMarginRate,
    sell_hedge_margin_rate_pct: row.sellHedgeMarginRate,
    long_margin_rate_pct: row.longMarginRate,
    short_margin_rate_pct: row.shortMarginRate,
    close_today_fee: row.closeTodayFee,
    exchange: row.exchange,
  }));
}
