import * as st from '../lib/stats.js';
import { EngineData } from './data.js';
import { Portfolio } from './portfolio.js';
import { DEFAULT_COST, type BacktestResult, type BarContext, type EngineConfig } from './types.js';

const PERIODS_PER_YEAR = 252; // trading days

/**
 * Run an event-driven strategy backtest.
 *
 * Loop per trading day D:
 *   1. execute the rebalance queued on D-1, filled at D's open
 *   2. mark equity at D's close → daily NAV
 *   3. call strategy.onBar(ctx); the strategy may queue a new target book for next open
 *
 * MVP simplifications (documented): adjusted (hfq) prices for both marking and fills (total return,
 * no explicit dividend/split share handling); fractional shares (no 100-share lot rounding);
 * fills at next-day open; T+1 enforced; costs applied. Limit-up/down, ST and suspension *blocking*
 * are Phase 2 (need the second data batch) — a suspended stock simply gets no fill that day.
 */
export async function runStrategy(cfg: EngineConfig): Promise<BacktestResult> {
  const cost = { ...DEFAULT_COST, ...cfg.cost };
  const data = new EngineData(cfg.start, cfg.end);
  await data.load();
  const pf = new Portfolio(cfg.initialCash, cost);

  const nav: { date: string; value: number }[] = [];
  let pendingTargets: Map<string, number> | null = null;

  for (const date of data.timeline) {
    // 1. Execute the rebalance queued yesterday, at today's open.
    if (pendingTargets) {
      const codes = new Set<string>([...pendingTargets.keys(), ...pf.positions.keys()]);
      await data.loadBars([...codes]); // ensure bars before fills/marking
      rebalance(pf, data, date, pendingTargets);
      pendingTargets = null;
    }

    // 2. Mark equity at today's close.
    nav.push({ date, value: pf.equity((c) => data.closeAt(c, date)) });

    // 3. Strategy decides (sync). It may set a new target book to execute next open.
    const collected: { targets: Map<string, number> | null } = { targets: null };
    cfg.strategy.onBar(buildContext(date, data, pf, collected));
    if (collected.targets) pendingTargets = collected.targets;
  }

  return summarize(cfg, nav, pf.trades);
}

// —— helpers ——

function buildContext(
  date: string,
  data: EngineData,
  pf: Portfolio,
  collected: { targets: Map<string, number> | null },
): BarContext {
  return {
    date,
    get cash() {
      return pf.cash;
    },
    get value() {
      return pf.equity((c) => data.closeAt(c, date));
    },
    positions() {
      return [...pf.positions].map(([code, p]) => ({
        code,
        shares: p.shares,
        marketValue: p.shares * (data.closeAt(code, date) ?? 0),
      }));
    },
    price(code) {
      return data.closeAt(code, date);
    },
    history(code, n) {
      return data.history(code, date, n);
    },
    universe() {
      return data.universe(date);
    },
    factor(name, code) {
      return data.factor(name, date, code);
    },
    orderTargetPercent(code, weight) {
      (collected.targets ??= new Map()).set(code, weight);
    },
    setHoldings(weights) {
      const m = new Map<string, number>();
      const entries = weights instanceof Map ? weights : Object.entries(weights);
      for (const [c, w] of entries) m.set(c, w);
      collected.targets = m;
    },
  };
}

/** Reconcile the book to target weights at `date`'s open: sell non-targets first, then buy. */
function rebalance(
  pf: Portfolio,
  data: EngineData,
  date: string,
  targets: Map<string, number>,
): void {
  const sellableFrom = data.nextDay(date);
  const openOf = (c: string) => data.openAt(c, date);

  // Equity valued at today's open, consistent with fill prices.
  const equity = pf.equity((c) => openOf(c) ?? data.closeAt(c, date));

  const targetShares = new Map<string, number>();
  for (const [code, w] of targets) {
    const px = openOf(code);
    if (px && px > 0) targetShares.set(code, (w * equity) / px);
  }

  // Sells first (free up cash). Skip suspended (no open) and T+1-frozen shares.
  for (const [code, pos] of [...pf.positions]) {
    const px = openOf(code);
    if (px == null) continue;
    if (pos.frozenUntil > date) continue;
    const tgt = targetShares.get(code) ?? 0;
    if (tgt < pos.shares) pf.fill(code, tgt - pos.shares, px, date, sellableFrom);
  }

  // Buys.
  for (const [code, tgt] of targetShares) {
    const px = openOf(code)!;
    const cur = pf.positions.get(code)?.shares ?? 0;
    if (tgt > cur) pf.fill(code, tgt - cur, px, date, sellableFrom);
  }
}

function summarize(
  cfg: EngineConfig,
  nav: { date: string; value: number }[],
  trades: number,
): BacktestResult {
  const values = nav.map((n) => n.value);
  const rets: number[] = [];
  for (let i = 1; i < values.length; i++) rets.push(values[i] / values[i - 1] - 1);
  const finalValue = values.at(-1) ?? cfg.initialCash;
  return {
    name: cfg.strategy.name,
    start: cfg.start,
    end: cfg.end,
    days: nav.length,
    initialCash: cfg.initialCash,
    finalValue,
    totalReturn: finalValue / cfg.initialCash - 1,
    annReturn: st.annualizedReturn(rets, PERIODS_PER_YEAR),
    sharpe: st.sharpe(rets, PERIODS_PER_YEAR),
    maxDrawdown: st.maxDrawdown(values),
    trades,
    nav,
  };
}
