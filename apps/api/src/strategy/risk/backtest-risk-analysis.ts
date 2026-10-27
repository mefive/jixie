import type { PortfolioRiskAnalysisV1 } from '@jixie/shared';
import { getDatabase, type Prisma } from '#infra/database/prisma.js';
import { loadMacroRiskAxisHistory, type MacroRiskAxisHistoryV1 } from '#market/macro/risk-axes.js';
import {
  aggregatePortfolioMonthlyReturns,
  estimatePortfolioMacroRisk,
} from './macro-risk-model.js';
import type { BacktestResult } from '../backtests/result.js';

/**
 * 只保留已有月度宏观敏感度；依赖期货连续收益的日频回归和压力情景已退役。
 *
 * Retain the existing monthly macro estimate after retiring futures-dependent daily risk models.
 */
export function buildBacktestRiskAnalysis(
  result: BacktestResult,
  input: { macroHistory?: MacroRiskAxisHistoryV1 | null },
): PortfolioRiskAnalysisV1 | undefined {
  const nav = allocationNav(result);
  if (
    !result.allocationAnalysis ||
    nav.length < 2 ||
    nav.some((point) => point.value <= 0) ||
    !input.macroHistory
  ) {
    return undefined;
  }

  const monthlyReturns = aggregatePortfolioMonthlyReturns(
    nav
      .slice(1)
      .map((point, index) => ({ date: point.date, return: point.value / nav[index]!.value - 1 })),
  );
  const macro = estimatePortfolioMacroRisk(monthlyReturns, input.macroHistory, {
    asOfDate: result.end,
  });

  return macro
    ? { version: 1, separationPolicy: 'daily_market_risk_and_monthly_macro_sensitivity', macro }
    : undefined;
}

/**
 * 为当前现金回测附加独立的月度宏观分析，不加载退役的期货来源。
 *
 * Attach independent monthly macro analysis without loading retired futures sources.
 */
export async function attachBacktestRiskAnalysis(
  result: BacktestResult,
  database: Prisma = getDatabase(),
): Promise<void> {
  const nav = allocationNav(result);
  if (
    !result.allocationAnalysis ||
    nav.length < 2 ||
    nav.some((point) => point.value <= 0) ||
    result.end < '20180326'
  ) {
    return;
  }

  const macroHistory = await loadMacroRiskAxisHistory(
    { startDate: result.start, endDate: result.end, revisionPolicy: 'latest_vintage' },
    database,
  );
  const risk = buildBacktestRiskAnalysis(result, { macroHistory });
  if (risk) {
    result.allocationAnalysis.risk = risk;
  }
}

function allocationNav(result: BacktestResult): BacktestResult['nav'] {
  return result.allocationAnalysis?.scope === 'cash_account'
    ? (result.allocationAnalysis.nav ?? [])
    : result.nav;
}
