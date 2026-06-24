import * as st from '../lib/stats.js';
import { EngineData, type CrossSection } from './data.js';
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
  const data = new EngineData(cfg.start, cfg.end, cfg.strategy.factors ?? []);
  await data.load();
  if (cfg.strategy.watch?.length) await data.loadBars(cfg.strategy.watch); // per-instrument preload
  const pf = new Portfolio(cfg.initialCash, cost);

  const nav: { date: string; value: number }[] = [];
  let pendingTargets: Map<string, number> | null = null;
  let pendingOrders: Map<string, number> | null = null;

  for (const date of data.timeline) {
    // 1. Execute what was queued yesterday, at today's open (declarative rebalance OR share orders).
    if (pendingTargets) {
      const codes = new Set<string>([...pendingTargets.keys(), ...pf.positions.keys()]);
      await data.loadBars([...codes]); // ensure bars before fills/marking
      rebalance(pf, data, date, pendingTargets);
      pendingTargets = null;
    }
    if (pendingOrders) {
      await data.loadBars([...pendingOrders.keys()]);
      executeOrders(pf, data, date, pendingOrders);
      pendingOrders = null;
    }

    // 2. Mark equity at today's close.
    nav.push({ date, value: pf.equity((c) => data.closeAt(c, date)) });

    // 3. Strategy decides (may await market data). It may queue targets or orders for next open.
    const collected: {
      targets: Map<string, number> | null;
      orders: Map<string, number> | null;
    } = { targets: null, orders: null };
    await cfg.strategy.onBar(buildContext(date, data, pf, collected));
    if (collected.targets) pendingTargets = collected.targets;
    if (collected.orders) pendingOrders = collected.orders;
  }

  return summarize(cfg, nav, pf.trades);
}

// —— helpers ——

function buildContext(
  date: string,
  data: EngineData,
  pf: Portfolio,
  collected: { targets: Map<string, number> | null; orders: Map<string, number> | null },
): BarContext {
  let cross: CrossSection | null = null; // today's cross-section, loaded on first universe() call
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
        avgCost: p.avgCost,
        marketValue: p.shares * (data.closeAt(code, date) ?? 0),
      }));
    },
    async universe() {
      cross = await data.crossSection(date);
      return cross.codes;
    },
    bar(code) {
      return cross?.byCode.get(code) ?? null;
    },
    bars(code, n) {
      return data.bars(code, date, n);
    },
    listDays(code) {
      return data.listDays(code, date);
    },
    price(code) {
      return data.closeAt(code, date);
    },
    history(code, field, n) {
      return data.history(code, date, field, n);
    },
    factor(name, code) {
      return data.factor(name, date, code);
    },
    shares(code) {
      return pf.positions.get(code)?.shares ?? 0;
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
    order(code, shares) {
      if (!shares) return;
      const m = (collected.orders ??= new Map());
      m.set(code, (m.get(code) ?? 0) + shares);
    },
    exit(code) {
      const held = pf.positions.get(code)?.shares ?? 0;
      if (held > 0) (collected.orders ??= new Map()).set(code, -held);
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

/**
 * Execute imperative share orders at `date`'s open. Sells run first (free up cash); a sell is
 * clamped to the T+1-sellable shares actually held, a buy to what cash can afford. Suspended codes
 * (no open) are skipped — the strategy can re-queue next bar.
 */
function executeOrders(
  pf: Portfolio,
  data: EngineData,
  date: string,
  orders: Map<string, number>,
): void {
  const sellableFrom = data.nextDay(date);

  for (const [code, delta] of orders) {
    if (delta >= 0) continue;
    const px = data.openAt(code, date);
    const pos = pf.positions.get(code);
    if (px == null || !pos || pos.frozenUntil > date) continue; // suspended or T+1-frozen
    const sell = Math.min(-delta, pos.shares);
    if (sell > 0) pf.fill(code, -sell, px, date, sellableFrom);
  }

  for (const [code, delta] of orders) {
    if (delta <= 0) continue;
    const px = data.openAt(code, date);
    if (px == null || px <= 0) continue; // suspended
    const buy = Math.min(delta, pf.affordableShares(px));
    if (buy > 0) pf.fill(code, buy, px, date, sellableFrom);
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
