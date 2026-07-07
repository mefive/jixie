import { DEFAULT_LOCALE } from '@jixie/shared';
import * as st from '../lib/stats.js';
import { t } from '../i18n/index.js';
import { EngineData, type CrossSection } from './data.js';
import { Portfolio } from './portfolio.js';
import {
  DEFAULT_COST,
  type BacktestResult,
  type BarContext,
  type CostModel,
  type EngineConfig,
} from './types.js';

const PERIODS_PER_YEAR = 252; // trading days
const BENCHMARK = '000300.SH'; // CSI 300 — the excess/IR benchmark
const MAX_SLIP = 0.1; // cap slippage at 10% so a huge order in an illiquid name can't produce absurd fills

/**
 * Run an event-driven strategy backtest.
 *
 * Loop per trading day D:
 *   1. execute the rebalance queued on D-1, filled at D's open
 *   2. mark equity at D's close → daily NAV
 *   3. call strategy.onBar(ctx); the strategy may queue a new target book for next open
 *
 * MVP simplifications (documented): hfq prices for marking + internal accounting (total return, dividends
 * reinvested via adj — no explicit cash-dividend events); buys size in whole lots (100-share lots) of REAL
 * shares (floored), so trades are realistically tradable while marking stays hfq; fills at next-day open;
 * T+1 enforced; costs + slippage applied (fees on `fee`, slippage worsens the fill price via a base
 * half-spread + a size/liquidity impact term — see execPrice); up-limit stocks can't be bought and
 * down-limit stocks can't be sold (blocked at the limit open); a suspended stock
 * gets no fill that day. A blocked order is NOT carried over — the strategy re-expresses intent each bar
 * (condition-based exits re-fire daily until fillable). ST filtering is left to the strategy.
 */
export async function runStrategy(cfg: EngineConfig): Promise<BacktestResult> {
  const cost = { ...DEFAULT_COST, ...cfg.cost };
  const locale = cfg.locale ?? DEFAULT_LOCALE;
  const log = cfg.onLog ?? (() => {}); // progress sink (worker forwards to the job; scripts no-op)
  const engineData = new EngineData(cfg.start, cfg.end, cfg.strategy.factors ?? [], log, locale);
  await engineData.load();
  if (cfg.strategy.watch?.length) {
    await engineData.loadBars(cfg.strategy.watch);
  } // per-instrument preload
  const portfolio = new Portfolio(cfg.initialCash, cost);

  const yuan = (v: number) => `¥${Math.round(v).toLocaleString()}`;
  log(
    t(locale, 'backtestStart', {
      start: fmtDate(cfg.start),
      end: fmtDate(cfg.end),
      cash: yuan(cfg.initialCash),
    }),
  );

  const nav: { date: string; value: number }[] = [];
  let pendingTargets: Map<string, number> | null = null;
  let pendingOrders: Map<string, number> | null = null;
  let lastYear = '';
  const total = engineData.timeline.length;

  for (let i = 0; i < total; i++) {
    const date = engineData.timeline[i];
    // 1. Execute what was queued yesterday, at today's open (declarative rebalance OR share orders).
    if (pendingTargets) {
      const codes = new Set<string>([...pendingTargets.keys(), ...portfolio.positions.keys()]);
      await engineData.loadBars([...codes]); // ensure bars before fills/marking
      rebalance(portfolio, engineData, date, pendingTargets, cost);
      pendingTargets = null;
      log(t(locale, 'backtestRebalance', { date: fmtDate(date), count: portfolio.positions.size }));
    }
    if (pendingOrders) {
      await engineData.loadBars([...pendingOrders.keys()]);
      executeOrders(portfolio, engineData, date, pendingOrders, cost);
      pendingOrders = null;
    }

    // 2. Mark equity at today's close.
    const value = portfolio.equity((c) => engineData.closeAt(c, date));
    nav.push({ date, value });

    // Yearly heartbeat — keeps the run visibly advancing even between rebalances (any archetype).
    const year = date.slice(0, 4);
    if (year !== lastYear) {
      lastYear = year;
      log(
        t(locale, 'backtestYearlyHeartbeat', {
          year,
          equity: yuan(value),
          pct: Math.round(((i + 1) / total) * 100),
        }),
      );
    }

    // 3. Strategy decides (may await market data). It may queue targets or orders for next open.
    const collected: {
      targets: Map<string, number> | null;
      orders: Map<string, number> | null;
    } = { targets: null, orders: null };
    await cfg.strategy.onBar(buildContext(date, engineData, portfolio, collected));
    if (collected.targets) {
      pendingTargets = collected.targets;
    }
    if (collected.orders) {
      pendingOrders = collected.orders;
    }
  }

  const bench = engineData.indexCloses(BENCHMARK); // CSI 300 for excess-return/IR (preloaded)
  const result = summarize(cfg, nav, portfolio.trades, bench);
  log(
    t(locale, 'backtestDone', {
      days: result.days,
      trades: result.trades,
      finalValue: yuan(result.finalValue),
      ret: (result.totalReturn * 100).toFixed(2),
    }),
  );
  return result;
}

// —— helpers ——

/** YYYYMMDD → YYYY-MM-DD for log lines. */
function fmtDate(d: string): string {
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

function buildContext(
  date: string,
  engineData: EngineData,
  portfolio: Portfolio,
  collected: { targets: Map<string, number> | null; orders: Map<string, number> | null },
): BarContext {
  let cross: CrossSection | null = null; // today's cross-section, loaded on first loadCrossSection() call
  return {
    date,
    get cash() {
      return portfolio.cash;
    },
    get value() {
      return portfolio.equity((c) => engineData.closeAt(c, date));
    },
    positions() {
      return [...portfolio.positions].map(([code, p]) => ({
        code,
        shares: p.shares,
        avgCost: p.avgCost,
        marketValue: p.shares * (engineData.closeAt(code, date) ?? 0),
      }));
    },
    async loadCrossSection(indexCode) {
      cross = await engineData.crossSection(date, indexCode);
      return cross.codes;
    },
    bar(code) {
      return cross?.byCode.get(code) ?? null;
    },
    bars(code, n) {
      return engineData.bars(code, date, n);
    },
    ensureBars(codes) {
      return engineData.loadBars(codes);
    },
    listDays(code) {
      return engineData.listDays(code, date);
    },
    industry(code) {
      return engineData.industry(code);
    },
    lhbNet(code) {
      return engineData.lhbNet(code, date);
    },
    price(code) {
      return engineData.closeAt(code, date);
    },
    history(code, field, n) {
      return engineData.history(code, date, field, n);
    },
    factor(name, code) {
      return engineData.factor(name, date, code);
    },
    indexMembers(indexCode) {
      return engineData.indexMembers(indexCode, date);
    },
    index(indexCode) {
      // Read-only market-index handle, point-in-time as-of today. Not tradable (no order/hold).
      return {
        get close() {
          return engineData.indexCloseAsOf(indexCode, date);
        },
        sma(n: number) {
          return engineData.indexSma(indexCode, date, n);
        },
      };
    },
    shares(code) {
      return portfolio.positions.get(code)?.shares ?? 0;
    },
    orderTargetPercent(code, weight) {
      if (collected.targets == null) {
        collected.targets = new Map();
      }
      collected.targets.set(code, weight);
    },
    setHoldings(weights) {
      // Normalize object or Map input into the engine's target-weight map.
      const targetWeights = new Map<string, number>();
      const weightEntries = weights instanceof Map ? weights : Object.entries(weights);
      for (const [code, weight] of weightEntries) {
        targetWeights.set(code, weight);
      }
      collected.targets = targetWeights;
    },
    order(code, shares) {
      if (!shares) {
        return;
      }
      if (collected.orders == null) {
        collected.orders = new Map();
      }
      collected.orders.set(code, (collected.orders.get(code) ?? 0) + shares);
    },
    exit(code) {
      const held = portfolio.positions.get(code)?.shares ?? 0;
      if (held > 0) {
        if (collected.orders == null) {
          collected.orders = new Map();
        }
        collected.orders.set(code, (collected.orders.get(code) ?? 0) - held);
      }
    },
  };
}

/** Reconcile the book to target weights at `date`'s open: sell non-targets first, then buy. Sizing +
 * marking use the raw open (consistent with the day's equity mark); the actual FILL price is the open
 * worsened by slippage (buys above, sells below). */
function rebalance(
  portfolio: Portfolio,
  engineData: EngineData,
  date: string,
  targets: Map<string, number>,
  cost: CostModel,
): void {
  const sellableFrom = engineData.nextDay(date);
  const openOf = (c: string) => engineData.openAt(c, date);

  // Equity valued at today's open, consistent with fill prices.
  const equity = portfolio.equity((c) => openOf(c) ?? engineData.closeAt(c, date));

  const targetShares = new Map<string, number>();
  for (const [code, w] of targets) {
    const px = openOf(code);
    if (px && px > 0) {
      targetShares.set(code, (w * equity) / px);
    }
  }

  // Sells first (free up cash). Skip suspended (no open) and T+1-frozen shares.
  for (const [code, pos] of [...portfolio.positions]) {
    const px = openOf(code);
    if (px == null) {
      continue;
    }
    if (pos.frozenUntil > date) {
      continue;
    }
    const tgt = targetShares.get(code) ?? 0;
    if (tgt < pos.shares && !limitBlocked(engineData, code, date, 'sell', px)) {
      const delta = tgt - pos.shares;
      const fillPx = execPrice(engineData, code, date, 'sell', px, -delta * px, cost);
      portfolio.fill(code, delta, fillPx, date, sellableFrom, engineData.adjAt(code, date)!);
    }
  }

  // Buys.
  for (const [code, tgt] of targetShares) {
    const px = openOf(code)!;
    const cur = portfolio.positions.get(code)?.shares ?? 0;
    if (tgt > cur && !limitBlocked(engineData, code, date, 'buy', px)) {
      const delta = tgt - cur;
      const fillPx = execPrice(engineData, code, date, 'buy', px, delta * px, cost);
      portfolio.fill(code, delta, fillPx, date, sellableFrom, engineData.adjAt(code, date)!);
    }
  }
}

/**
 * Execute imperative share orders at `date`'s open. Sells run first (free up cash); a sell is
 * clamped to the T+1-sellable shares actually held, a buy to what cash can afford. Suspended codes
 * (no open) are skipped — the strategy can re-queue next bar.
 */
function executeOrders(
  portfolio: Portfolio,
  engineData: EngineData,
  date: string,
  orders: Map<string, number>,
  cost: CostModel,
): void {
  const sellableFrom = engineData.nextDay(date);

  for (const [code, delta] of orders) {
    if (delta >= 0) {
      continue;
    }
    const px = engineData.openAt(code, date);
    const pos = portfolio.positions.get(code);
    if (px == null || !pos || pos.frozenUntil > date) {
      continue;
    } // suspended or T+1-frozen
    const sell = Math.min(-delta, pos.shares);
    if (sell > 0 && !limitBlocked(engineData, code, date, 'sell', px)) {
      const fillPx = execPrice(engineData, code, date, 'sell', px, sell * px, cost);
      portfolio.fill(code, -sell, fillPx, date, sellableFrom, engineData.adjAt(code, date)!);
    }
  }

  for (const [code, delta] of orders) {
    if (delta <= 0) {
      continue;
    }
    const px = engineData.openAt(code, date);
    if (px == null || px <= 0) {
      continue;
    } // suspended
    if (limitBlocked(engineData, code, date, 'buy', px)) {
      continue;
    } // up-limit sealed — can't buy
    // Slippage lifts the buy price → size affordability on the slipped price so we don't overspend.
    const fillPx = execPrice(engineData, code, date, 'buy', px, delta * px, cost);
    const buy = Math.min(delta, portfolio.affordableShares(fillPx));
    if (buy > 0) {
      portfolio.fill(code, buy, fillPx, date, sellableFrom, engineData.adjAt(code, date)!);
    }
  }
}

/** Execution price = the open worsened by slippage: a base half-spread (every fill pays it) plus a linear
 * price impact that scales with the order's notional vs. the day's turnover (a big order in a thin small-cap
 * pays more — the whole point). Buys fill above the open, sells below. hfq in → hfq out; `notionalYuan`
 * is real money (= |hfq shares| × hfq open). No turnover for the day → impact term drops (base only). */
export function execPrice(
  engineData: EngineData,
  code: string,
  date: string,
  side: 'buy' | 'sell',
  hfqOpen: number,
  notionalYuan: number,
  cost: CostModel,
): number {
  const base = cost.slippageBps / 1e4;
  const dayTurnoverYuan = (engineData.amountAt(code, date) ?? 0) * 1000; // amount is in thousand yuan
  const impact = dayTurnoverYuan > 0 ? cost.impactCoef * (notionalYuan / dayTurnoverYuan) : 0;
  const slip = Math.min(base + impact, MAX_SLIP);
  return side === 'buy' ? hfqOpen * (1 + slip) : hfqOpen * (1 - slip);
}

/** True if a fill is blocked by the day's price limit: you can't buy at/above the up-limit open nor sell
 * at/below the down-limit open (one-line / sealed limit board). Limits are unadjusted, so compare against raw open
 * (hfqOpen / adj). No limit data for the day → not blocked (can't tell). */
function limitBlocked(
  engineData: EngineData,
  code: string,
  date: string,
  side: 'buy' | 'sell',
  hfqOpen: number,
): boolean {
  const lim = engineData.limitAt(code, date);
  if (!lim) {
    return false;
  }
  const adj = engineData.adjAt(code, date);
  if (adj == null || adj <= 0) {
    return false;
  }
  const rawOpen = hfqOpen / adj;
  const EPS = 1e-3;
  return side === 'buy'
    ? lim.up != null && rawOpen >= lim.up - EPS
    : lim.down != null && rawOpen <= lim.down + EPS;
}

function summarize(
  cfg: EngineConfig,
  nav: { date: string; value: number }[],
  tradeLog: BacktestResult['tradeLog'],
  bench: { date: string; close: number }[],
): BacktestResult {
  const values = nav.map((n) => n.value);
  const dailyReturns: number[] = [];
  for (let i = 1; i < values.length; i++) {
    dailyReturns.push(values[i] / values[i - 1] - 1);
  }
  const finalValue = values.at(-1) ?? cfg.initialCash;
  const totalReturn = finalValue / cfg.initialCash - 1;
  const annReturn = st.annualizedReturn(dailyReturns, PERIODS_PER_YEAR);
  const maxDrawdown = st.maxDrawdown(values); // ≤ 0

  // —— Benchmark comparison (CSI 300): excess return + annualized information ratio ——
  const benchByDate = new Map(bench.map((b) => [b.date, b.close]));
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
  const book = new Map<string, { shares: number; cost: number }>(); // real shares + total real cost (incl. fees)
  let wins = 0;
  let closes = 0;
  let winSum = 0;
  let lossSum = 0;
  for (const t of tradeLog) {
    const p = book.get(t.code) ?? { shares: 0, cost: 0 };
    if (t.side === 'buy') {
      p.shares += t.realShares;
      p.cost += t.amount + t.fee;
    } else {
      const avgCost = p.shares > 0 ? p.cost / p.shares : 0;
      const costOut = avgCost * t.realShares;
      const pnl = t.amount - t.fee - costOut; // sell net proceeds − cost of the sold shares
      closes += 1;
      if (pnl >= 0) {
        wins += 1;
        winSum += pnl;
      } else {
        lossSum += -pnl;
      }
      p.shares -= t.realShares;
      p.cost -= costOut;
      if (p.shares <= 1e-6) {
        p.shares = 0;
        p.cost = 0;
      }
    }
    book.set(t.code, p);
  }
  const winRate = closes > 0 ? wins / closes : 0;
  const profitFactor = lossSum > 0 ? winSum / lossSum : winSum > 0 ? 99 : 0;

  // —— Annualized turnover = one-side traded value / average equity / year ——
  const avgEquity = st.mean(values);
  const traded = tradeLog.reduce((s, t) => s + t.amount, 0);
  const years = nav.length / PERIODS_PER_YEAR;
  const turnover = avgEquity > 0 && years > 0 ? traded / 2 / avgEquity / years : 0;

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
    benchReturn,
    excessReturn: totalReturn - benchReturn,
    informationRatio,
    calmar: maxDrawdown < 0 ? annReturn / -maxDrawdown : 0,
    winRate,
    profitFactor,
    turnover,
    monthly,
  };
}
