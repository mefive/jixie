import * as st from '../lib/stats.js';
import { EngineData, type CrossSection } from './data.js';
import { Portfolio } from './portfolio.js';
import { DEFAULT_COST, type BacktestResult, type BarContext, type EngineConfig } from './types.js';

const PERIODS_PER_YEAR = 252; // trading days
const BENCHMARK = '000300.SH'; // 沪深300 — the excess/IR benchmark

/**
 * Run an event-driven strategy backtest.
 *
 * Loop per trading day D:
 *   1. execute the rebalance queued on D-1, filled at D's open
 *   2. mark equity at D's close → daily NAV
 *   3. call strategy.onBar(ctx); the strategy may queue a new target book for next open
 *
 * MVP simplifications (documented): hfq prices for marking + internal accounting (total return, dividends
 * reinvested via adj — no explicit cash-dividend events); buys size in whole 手 (100-share lots) of REAL
 * shares (floored), so trades are realistically tradable while marking stays hfq; fills at next-day open;
 * T+1 enforced; costs applied; 涨停板不可买、跌停板不可卖 (blocked at the limit open); a suspended stock
 * gets no fill that day. A blocked order is NOT carried over — the strategy re-expresses intent each bar
 * (condition-based exits re-fire daily until fillable). ST filtering is left to the strategy.
 */
export async function runStrategy(cfg: EngineConfig): Promise<BacktestResult> {
  const cost = { ...DEFAULT_COST, ...cfg.cost };
  const log = cfg.onLog ?? (() => {}); // progress sink (worker forwards to the job; scripts no-op)
  const data = new EngineData(cfg.start, cfg.end, cfg.strategy.factors ?? [], log);
  await data.load();
  if (cfg.strategy.watch?.length) await data.loadBars(cfg.strategy.watch); // per-instrument preload
  const pf = new Portfolio(cfg.initialCash, cost);

  const yuan = (v: number) => `¥${Math.round(v).toLocaleString()}`;
  log(`开始回测 · ${fmtDate(cfg.start)} ~ ${fmtDate(cfg.end)} · 初始资金 ${yuan(cfg.initialCash)}`);

  const nav: { date: string; value: number }[] = [];
  let pendingTargets: Map<string, number> | null = null;
  let pendingOrders: Map<string, number> | null = null;
  let lastYear = '';
  const total = data.timeline.length;

  for (let i = 0; i < total; i++) {
    const date = data.timeline[i];
    // 1. Execute what was queued yesterday, at today's open (declarative rebalance OR share orders).
    if (pendingTargets) {
      const codes = new Set<string>([...pendingTargets.keys(), ...pf.positions.keys()]);
      await data.loadBars([...codes]); // ensure bars before fills/marking
      rebalance(pf, data, date, pendingTargets);
      pendingTargets = null;
      log(`${fmtDate(date)} 调仓 → 持仓 ${pf.positions.size} 只`);
    }
    if (pendingOrders) {
      await data.loadBars([...pendingOrders.keys()]);
      executeOrders(pf, data, date, pendingOrders);
      pendingOrders = null;
    }

    // 2. Mark equity at today's close.
    const value = pf.equity((c) => data.closeAt(c, date));
    nav.push({ date, value });

    // Yearly heartbeat — keeps the run visibly advancing even between rebalances (any archetype).
    const year = date.slice(0, 4);
    if (year !== lastYear) {
      lastYear = year;
      log(`${year} · 权益 ${yuan(value)} · 进度 ${Math.round(((i + 1) / total) * 100)}%`);
    }

    // 3. Strategy decides (may await market data). It may queue targets or orders for next open.
    const collected: {
      targets: Map<string, number> | null;
      orders: Map<string, number> | null;
    } = { targets: null, orders: null };
    await cfg.strategy.onBar(buildContext(date, data, pf, collected));
    if (collected.targets) pendingTargets = collected.targets;
    if (collected.orders) pendingOrders = collected.orders;
  }

  const bench = data.indexCloses(BENCHMARK); // 沪深300 for 超额/IR (preloaded)
  const result = summarize(cfg, nav, pf.trades, bench);
  log(
    `完成 · ${result.days} 天 · ${result.trades} 笔 · 期末 ${yuan(result.finalValue)} · 收益 ${(result.totalReturn * 100).toFixed(2)}%`,
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
  data: EngineData,
  pf: Portfolio,
  collected: { targets: Map<string, number> | null; orders: Map<string, number> | null },
): BarContext {
  let cross: CrossSection | null = null; // today's cross-section, loaded on first loadCrossSection() call
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
    async loadCrossSection(indexCode) {
      cross = await data.crossSection(date, indexCode);
      return cross.codes;
    },
    bar(code) {
      return cross?.byCode.get(code) ?? null;
    },
    bars(code, n) {
      return data.bars(code, date, n);
    },
    ensureBars(codes) {
      return data.loadBars(codes);
    },
    listDays(code) {
      return data.listDays(code, date);
    },
    industry(code) {
      return data.industry(code);
    },
    lhbNet(code) {
      return data.lhbNet(code, date);
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
    indexMembers(indexCode) {
      return data.indexMembers(indexCode, date);
    },
    index(indexCode) {
      // Read-only 大盘 handle, point-in-time as-of today. Not tradable (no order/hold).
      return {
        get close() {
          return data.indexCloseAsOf(indexCode, date);
        },
        sma(n: number) {
          return data.indexSma(indexCode, date, n);
        },
      };
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
    if (tgt < pos.shares && !limitBlocked(data, code, date, 'sell', px))
      pf.fill(code, tgt - pos.shares, px, date, sellableFrom, data.adjAt(code, date)!);
  }

  // Buys.
  for (const [code, tgt] of targetShares) {
    const px = openOf(code)!;
    const cur = pf.positions.get(code)?.shares ?? 0;
    if (tgt > cur && !limitBlocked(data, code, date, 'buy', px))
      pf.fill(code, tgt - cur, px, date, sellableFrom, data.adjAt(code, date)!);
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
    if (sell > 0 && !limitBlocked(data, code, date, 'sell', px))
      pf.fill(code, -sell, px, date, sellableFrom, data.adjAt(code, date)!);
  }

  for (const [code, delta] of orders) {
    if (delta <= 0) continue;
    const px = data.openAt(code, date);
    if (px == null || px <= 0) continue; // suspended
    if (limitBlocked(data, code, date, 'buy', px)) continue; // 涨停封板 — can't buy
    const buy = Math.min(delta, pf.affordableShares(px));
    if (buy > 0) pf.fill(code, buy, px, date, sellableFrom, data.adjAt(code, date)!);
  }
}

/** True if a fill is blocked by the day's price limit: you can't buy at/above the up-limit open nor sell
 * at/below the down-limit open (一字板/封板). Limits are unadjusted, so compare against raw open
 * (hfqOpen / adj). No limit data for the day → not blocked (can't tell). */
function limitBlocked(
  data: EngineData,
  code: string,
  date: string,
  side: 'buy' | 'sell',
  hfqOpen: number,
): boolean {
  const lim = data.limitAt(code, date);
  if (!lim) return false;
  const adj = data.adjAt(code, date);
  if (adj == null || adj <= 0) return false;
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
  const rets: number[] = [];
  for (let i = 1; i < values.length; i++) rets.push(values[i] / values[i - 1] - 1);
  const finalValue = values.at(-1) ?? cfg.initialCash;
  const totalReturn = finalValue / cfg.initialCash - 1;
  const annReturn = st.annualizedReturn(rets, PERIODS_PER_YEAR);
  const maxDrawdown = st.maxDrawdown(values); // ≤ 0

  // —— 基准对比(沪深300): 超额 + 年化信息比率 ——
  const benchByDate = new Map(bench.map((b) => [b.date, b.close]));
  const benchInRange = nav.map((n) => benchByDate.get(n.date)).filter((v): v is number => v != null);
  const benchReturn = benchInRange.length >= 2 ? benchInRange.at(-1)! / benchInRange[0] - 1 : 0;
  const excessDaily: number[] = [];
  for (let i = 1; i < nav.length; i++) {
    const b1 = benchByDate.get(nav[i].date);
    const b0 = benchByDate.get(nav[i - 1].date);
    if (b0 != null && b1 != null && b0 > 0) excessDaily.push(rets[i - 1] - (b1 / b0 - 1));
  }
  const teStd = st.std(excessDaily);
  const informationRatio =
    teStd > 0 ? (st.mean(excessDaily) / teStd) * Math.sqrt(PERIODS_PER_YEAR) : 0;

  // —— 交易层面: 胜率 + 盈亏比(重放成交按均价配对平仓的已实现盈亏) ——
  const book = new Map<string, { shares: number; cost: number }>(); // real shares + total real cost (含费)
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
      const pnl = t.amount - t.fee - costOut; // 卖出净额 − 卖出份的成本
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

  // —— 年化换手 = 单边成交额 / 平均权益 / 年 ——
  const avgEquity = st.mean(values);
  const traded = tradeLog.reduce((s, t) => s + t.amount, 0);
  const years = nav.length / PERIODS_PER_YEAR;
  const turnover = avgEquity > 0 && years > 0 ? traded / 2 / avgEquity / years : 0;

  // —— 月度收益表(月末权益环比;首月基准为初始资金) ——
  const monthEnd = new Map<string, number>(); // 'YYYYMM' → 当月最后一个权益
  for (const n of nav) monthEnd.set(n.date.slice(0, 6), n.value);
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
    sharpe: st.sharpe(rets, PERIODS_PER_YEAR),
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
