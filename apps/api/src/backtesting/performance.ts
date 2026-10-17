import * as st from '#math/stats.js';
import type { BacktestingConfig } from './contract.js';
import type { CostModel } from './cost.js';
import type { BacktestingResult, SleeveNavPoint } from './result.js';
import type { CashTrade, FuturesTrade } from './trade.js';
const PERIODS_PER_YEAR = 252;

/**
 * 按净值日期对齐基准，汇总年化绩效、回撤、成交盈亏与费用；年化固定使用 252 期。
 * Align the benchmark to NAV dates and summarize annualized performance, drawdown, realized fills and costs using 252 periods per year.
 */
export function summarizePerformance(
  cfg: BacktestingConfig,
  nav: { date: string; value: number }[],
  tradeLog: BacktestingResult['tradeLog'],
  bench: { date: string; close: number }[],
  cost: CostModel,
  benchmarkCode: string,
  sleeveNav?: SleeveNavPoint[],
): BacktestingResult {
  const values = nav.map((n) => n.value);
  const dailyReturns: number[] = [];
  for (let i = 1; i < values.length; i++) {
    dailyReturns.push(values[i] / values[i - 1] - 1);
  }
  const finalValue = values.at(-1) ?? cfg.initialCash;
  const totalReturn = finalValue / cfg.initialCash - 1;
  const annReturn = st.annualizedReturn(dailyReturns, PERIODS_PER_YEAR);
  const maxDrawdown = st.maxDrawdown(values); // ≤ 0

  // —— Total-return benchmark comparison: excess return + annualized information ratio ——
  const benchByDate = new Map(bench.map((b) => [b.date, b.close]));
  const missingBenchmarkDate = nav.find((point) => !benchByDate.has(point.date))?.date;
  if (missingBenchmarkDate) {
    throw new Error(
      `Benchmark ${benchmarkCode} has no close for ${missingBenchmarkDate}; performance comparison cannot be computed`,
    );
  }
  const benchInRange = nav
    .map((n) => benchByDate.get(n.date))
    .filter((v): v is number => v != null);
  const benchReturn = benchInRange.length >= 2 ? benchInRange.at(-1)! / benchInRange[0] - 1 : 0;
  const excessDaily: number[] = [];
  for (let i = 1; i < nav.length; i++) {
    const benchToday = benchByDate.get(nav[i].date);
    const benchPrev = benchByDate.get(nav[i - 1].date);
    if (benchPrev != null && benchToday != null && benchPrev > 0) {
      excessDaily.push(dailyReturns[i - 1] - (benchToday / benchPrev - 1));
    }
  }
  const trackingErrorStd = st.std(excessDaily);
  const informationRatio =
    trackingErrorStd > 0
      ? (st.mean(excessDaily) / trackingErrorStd) * Math.sqrt(PERIODS_PER_YEAR)
      : 0;

  // —— Trade level: win rate + profit factor (replay fills, pair closes at average cost for realized P&L) ——
  const realized = [
    ...stockTradePnl(tradeLog.filter((trade) => trade.assetType !== 'future')),
    ...futuresTradePnl(tradeLog.filter((trade) => trade.assetType === 'future')),
  ];
  const { winRate, profitFactor } = realizedStats(realized);

  // —— Annualized turnover = one-side traded value / average equity / year ——
  const avgEquity = st.mean(values);
  const traded = tradeLog.reduce((s, t) => s + t.amount, 0);
  const years = nav.length / PERIODS_PER_YEAR;
  const turnover = avgEquity > 0 && years > 0 ? traded / 2 / avgEquity / years : 0;
  const totalFees = tradeLog.reduce((sum, trade) => sum + trade.fee, 0);
  const totalSlippage = tradeLog.reduce((sum, trade) => sum + trade.slippageCost, 0);

  // —— Monthly return table (month-end equity chained; first month based on initial cash) ——
  const monthEnd = new Map<string, number>(); // 'YYYYMM' → last equity of the month
  for (const n of nav) {
    monthEnd.set(n.date.slice(0, 6), n.value);
  }
  const monthly: { month: string; ret: number }[] = [];
  let prevValue = cfg.initialCash;
  for (const month of [...monthEnd.keys()].sort()) {
    const v = monthEnd.get(month)!;
    monthly.push({ month, ret: v / prevValue - 1 });
    prevValue = v;
  }

  return {
    name: cfg.strategy.name,
    start: cfg.start,
    end: cfg.end,
    days: nav.length,
    initialCash: cfg.initialCash,
    finalValue,
    totalReturn,
    annReturn,
    sharpe: st.sharpe(dailyReturns, PERIODS_PER_YEAR),
    maxDrawdown,
    trades: tradeLog.length,
    tradeLog,
    nav,
    sleeveNav,
    benchReturn,
    excessReturn: totalReturn - benchReturn,
    informationRatio,
    calmar: maxDrawdown < 0 ? annReturn / -maxDrawdown : 0,
    winRate,
    profitFactor,
    turnover,
    totalFees,
    totalSlippage,
    cost,
    monthly,
  };
}

/**
 * 按股票和 ETF 成交顺序重放平均成本，提取平仓已实现盈亏用于胜率统计。
 * Replay cash fills at average cost and extract realized closing profit for win-rate statistics.
 */
function stockTradePnl(tradeLog: CashTrade[]): number[] {
  const book = new Map<string, { shares: number; cost: number }>();
  const realized: number[] = [];
  for (const trade of tradeLog) {
    const position = book.get(trade.code) ?? { shares: 0, cost: 0 };
    if (trade.side === 'buy') {
      position.shares += trade.shares;
      position.cost += trade.amount + trade.fee;
    } else {
      const averageCost = position.shares > 0 ? position.cost / position.shares : 0;
      const costOut = averageCost * trade.shares;
      realized.push(trade.amount - trade.fee - costOut);
      position.shares -= trade.shares;
      position.cost -= costOut;
      if (position.shares <= 1e-6) {
        position.shares = 0;
        position.cost = 0;
      }
    }
    book.set(trade.code, position);
  }
  return realized;
}

/**
 * 按实际期货合约匹配成交与平仓，提取已实现盈亏供成交绩效统计。
 * Replay fills by actual futures contract and extract realized closing profit for trade statistics.
 */
function futuresTradePnl(tradeLog: FuturesTrade[]): number[] {
  const book = new Map<string, { contracts: number; averagePrice: number; entryFees: number }>();
  const realized: number[] = [];
  for (const trade of tradeLog) {
    const delta = (trade.side === 'buy' ? 1 : -1) * trade.contracts;
    const multiplier = trade.multiplier;
    const position = book.get(trade.code) ?? {
      contracts: 0,
      averagePrice: trade.price,
      entryFees: 0,
    };
    if (position.contracts === 0 || Math.sign(position.contracts) === Math.sign(delta)) {
      const nextContracts = position.contracts + delta;
      position.averagePrice =
        (Math.abs(position.contracts) * position.averagePrice + Math.abs(delta) * trade.price) /
        Math.abs(nextContracts);
      position.contracts = nextContracts;
      position.entryFees += trade.fee;
      book.set(trade.code, position);
      continue;
    }

    const closedContracts = Math.min(Math.abs(position.contracts), Math.abs(delta));
    const closeFraction = closedContracts / Math.abs(delta);
    const entryFeeShare = position.entryFees * (closedContracts / Math.abs(position.contracts));
    realized.push(
      closedContracts *
        Math.sign(position.contracts) *
        (trade.price - position.averagePrice) *
        multiplier -
        entryFeeShare -
        trade.fee * closeFraction,
    );
    const nextContracts = position.contracts + delta;
    if (nextContracts === 0) {
      book.delete(trade.code);
    } else if (Math.sign(nextContracts) === Math.sign(position.contracts)) {
      position.contracts = nextContracts;
      position.entryFees -= entryFeeShare;
      book.set(trade.code, position);
    } else {
      book.set(trade.code, {
        contracts: nextContracts,
        averagePrice: trade.price,
        entryFees: trade.fee * (1 - closeFraction),
      });
    }
  }
  return realized;
}

/**
 * 从已实现盈亏计算胜率和盈亏比，按实现处理无成交或无亏损边界。
 * Summarize realized outcomes into win rate and profit factor with the implementation's empty and no-loss conventions.
 */
function realizedStats(realized: number[]) {
  const wins = realized.filter((pnl) => pnl >= 0);
  const losses = realized.filter((pnl) => pnl < 0);
  const winSum = wins.reduce((sum, pnl) => sum + pnl, 0);
  const lossSum = losses.reduce((sum, pnl) => sum - pnl, 0);
  return {
    winRate: realized.length > 0 ? wins.length / realized.length : 0,
    profitFactor: lossSum > 0 ? winSum / lossSum : winSum > 0 ? 99 : 0,
  };
}
