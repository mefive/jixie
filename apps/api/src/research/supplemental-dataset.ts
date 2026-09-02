import type { ResearchMarketStateScopeV1 } from '@jixie/shared';
import { buildMarketStatePoints } from '../market/market-state.js';
import { addDays } from '../lib/date.js';
import { prisma } from '../lib/prisma.js';

export interface ResearchDatedIdentifierRequestV1 {
  identifier: string;
  start: string;
  end: string;
}

export interface ResearchMarketStateRequestV1 {
  scope: ResearchMarketStateScopeV1;
  start: string;
  end: string;
}

/** Load the full descriptive market-state series with enough history for activity warm-up. */
export async function loadResearchMarketState(request: ResearchMarketStateRequestV1) {
  const warmStart = addDays(request.start, -45);
  const rows =
    request.scope === 'all'
      ? await prisma.marketIndicator.findMany({
          where: { tradeDate: { gte: warmStart, lte: request.end } },
          orderBy: { tradeDate: 'asc' },
        })
      : await prisma.indexIndicator.findMany({
          where: {
            indexCode: request.scope,
            tradeDate: { gte: warmStart, lte: request.end },
          },
          orderBy: { tradeDate: 'asc' },
        });
  return buildMarketStatePoints(rows)
    .filter((row) => row.date >= request.start)
    .map((row) => ({
      date: row.date,
      activity: row.activity,
      breadth: row.breadth,
      trend: row.trend,
      crowding: row.crowding,
      advance_ratio: row.advanceRatio,
      above_ma20_ratio: row.aboveMa20Ratio,
      above_ma60_ratio: row.aboveMa60Ratio,
      total_amount_cny_1k: row.totalAmount,
      extreme_move_ratio: row.extremeMoveRatio,
      limit_up_count: row.limitUpCount,
      limit_down_count: row.limitDownCount,
      traded_count: row.tradedCount,
    }));
}

/** Load financial indicators only from their announcement date onward. */
export async function loadResearchEquityFundamentals(request: ResearchDatedIdentifierRequestV1) {
  const rows = await prisma.finaIndicator.findMany({
    where: {
      tsCode: request.identifier,
      annDate: { not: null, gte: request.start, lte: request.end },
    },
    orderBy: [{ annDate: 'asc' }, { endDate: 'asc' }],
  });
  return rows.map((row) => ({
    date: row.annDate!,
    report_period: row.endDate,
    roe_pct: row.roe,
    roe_waa_pct: row.roeWaa,
    roa_pct: row.roa,
    gross_profit_margin_pct: row.grossprofitMargin,
    net_profit_margin_pct: row.netprofitMargin,
    debt_to_assets_pct: row.debtToAssets,
    revenue_yoy_pct: row.orYoy,
    net_profit_yoy_pct: row.netprofitYoy,
    operating_cash_flow_to_profit: row.ocfToProfit,
  }));
}

/** Join exact-date money flow and Dragon-Tiger List events without carrying either series forward. */
export async function loadResearchEquityFlows(request: ResearchDatedIdentifierRequestV1) {
  const [moneyflow, topList] = await Promise.all([
    prisma.moneyflow.findMany({
      where: {
        tsCode: request.identifier,
        tradeDate: { gte: request.start, lte: request.end },
      },
      orderBy: { tradeDate: 'asc' },
    }),
    prisma.topList.findMany({
      where: {
        tsCode: request.identifier,
        tradeDate: { gte: request.start, lte: request.end },
      },
      orderBy: { tradeDate: 'asc' },
    }),
  ]);
  const byDate = new Map<
    string,
    {
      net_main_cny_10k: number | null;
      net_total_cny_10k: number | null;
      dragon_tiger_net_cny: number | null;
    }
  >();
  for (const row of moneyflow) {
    byDate.set(row.tradeDate, {
      net_main_cny_10k: row.netMain,
      net_total_cny_10k: row.netTotal,
      dragon_tiger_net_cny: null,
    });
  }
  for (const row of topList) {
    const current = byDate.get(row.tradeDate) ?? {
      net_main_cny_10k: null,
      net_total_cny_10k: null,
      dragon_tiger_net_cny: null,
    };
    current.dragon_tiger_net_cny = row.netAmount;
    byDate.set(row.tradeDate, current);
  }
  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, row]) => ({ date, ...row }));
}

/** Load only implemented distributions, using the ex-date as the availability gate. */
export async function loadResearchEquityDividends(request: ResearchDatedIdentifierRequestV1) {
  const rows = await prisma.dividend.findMany({
    where: {
      tsCode: request.identifier,
      divProc: '实施',
      exDate: { not: null, gte: request.start, lte: request.end },
    },
    orderBy: [{ exDate: 'asc' }, { endDate: 'asc' }],
  });
  return rows.map((row) => ({
    date: row.exDate!,
    report_period: row.endDate,
    announcement_date: row.annDate,
    cash_dividend_pre_tax: row.cashDiv,
    cash_dividend_tax_basis: row.cashDivTax,
  }));
}
