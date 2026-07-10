import { DEFAULT_LOCALE, isCustomFactorKey, type Locale } from '@jixie/shared';
import * as st from '../lib/stats.js';
import { t } from '../i18n/messages.js'; // direct import — keeps hono/locale out of the wall bundle
import { EngineData, type CrossSection } from './data.js';
import { CustomFactorRuntime, evaluateCustomFactorModule } from './custom-factor.js';
import { prismaDataPort } from './prisma-port.js';
import { Portfolio } from './portfolio.js';
import { FuturesPortfolio } from './futures-portfolio.js';
import {
  DEFAULT_COST,
  type BacktestResult,
  type BarContext,
  type CostModel,
  type EngineConfig,
  type SleeveNavPoint,
} from './types.js';

type FutureIntent =
  | { kind: 'delta'; value: number }
  | { kind: 'contracts'; value: number }
  | { kind: 'notional'; value: number }
  | { kind: 'hedge'; value: number };

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
  if (cfg.strategy.futures?.length) {
    return runMultiAssetStrategy(cfg);
  }
  return runStockStrategy(cfg);
}

async function runStockStrategy(cfg: EngineConfig): Promise<BacktestResult> {
  const cost = { ...DEFAULT_COST, ...cfg.cost };
  const locale = cfg.locale ?? DEFAULT_LOCALE;
  const log = cfg.onLog ?? (() => {}); // progress sink (worker forwards to the job; scripts no-op)
  const engineData = new EngineData(
    cfg.start,
    cfg.end,
    cfg.strategy.factors ?? [],
    log,
    locale,
    cfg.dataPort ?? prismaDataPort,
    [],
  );
  await engineData.load();
  if (cfg.strategy.watch?.length) {
    await engineData.loadBars(cfg.strategy.watch);
  } // per-instrument preload
  const customFactors = buildCustomFactorRuntime(cfg, engineData, locale, log);
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
    await cfg.strategy.onBar(buildContext(date, engineData, portfolio, collected, customFactors));
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

async function runMultiAssetStrategy(cfg: EngineConfig): Promise<BacktestResult> {
  const cost = { ...DEFAULT_COST, ...cfg.cost };
  const locale = cfg.locale ?? DEFAULT_LOCALE;
  const log = cfg.onLog ?? (() => {});
  const futureCodes = cfg.strategy.futures ?? [];
  const engineData = new EngineData(
    cfg.start,
    cfg.end,
    cfg.strategy.factors ?? [],
    log,
    locale,
    cfg.dataPort ?? prismaDataPort,
    futureCodes,
  );
  await engineData.load();
  if (cfg.strategy.watch?.length) {
    await engineData.loadBars(cfg.strategy.watch);
  }
  const customFactors = buildCustomFactorRuntime(cfg, engineData, locale, log);
  const allocation = accountAllocation(cfg);
  const stockPortfolio = new Portfolio(cfg.initialCash * allocation.stock, cost);
  const futurePortfolio = new FuturesPortfolio(cfg.initialCash * allocation.futures, cost);
  const nav: { date: string; value: number }[] = [];
  const sleeveNav: SleeveNavPoint[] = [];
  let pendingTargets: Map<string, number> | null = null;
  let pendingOrders: Map<string, number> | null = null;
  let pendingFutureIntents: Map<string, FutureIntent> | null = null;

  for (let index = 0; index < engineData.timeline.length; index++) {
    const date = engineData.timeline[index];
    const previousDate = engineData.timeline[index - 1];
    if (previousDate) {
      futurePortfolio.roll(engineData, date, previousDate);
      if (pendingTargets) {
        const codes = new Set<string>([
          ...pendingTargets.keys(),
          ...stockPortfolio.positions.keys(),
        ]);
        await engineData.loadBars([...codes]);
        rebalance(stockPortfolio, engineData, date, pendingTargets, cost);
        pendingTargets = null;
      }
      if (pendingOrders) {
        await engineData.loadBars([...pendingOrders.keys()]);
        executeOrders(stockPortfolio, engineData, date, pendingOrders, cost);
        pendingOrders = null;
      }
      if (pendingFutureIntents) {
        executeFutureIntents(
          futurePortfolio,
          stockPortfolio,
          engineData,
          date,
          previousDate,
          pendingFutureIntents,
        );
        pendingFutureIntents = null;
      }
    }

    futurePortfolio.settle(engineData, date);
    const stockValue = stockPortfolio.equity((code) => engineData.closeAt(code, date));
    const stockGrossExposure = stockPortfolio.marketValue((code) => engineData.closeAt(code, date));
    const futureNotional = futurePortfolio.notional((actualCode) => {
      const bar = engineData.futureActualBar(actualCode, date);
      return bar?.settle ?? bar?.close ?? null;
    });
    const value = stockValue + futurePortfolio.cash;
    nav.push({ date, value });
    sleeveNav.push({
      date,
      stockValue,
      futureValue: futurePortfolio.cash,
      futureMargin: futurePortfolio.margin,
      stockGrossExposure,
      futureNotional,
      netExposure: stockGrossExposure + futureNotional,
    });

    const collected = {
      targets: null as Map<string, number> | null,
      orders: null as Map<string, number> | null,
      futureIntents: null as Map<string, FutureIntent> | null,
    };
    await cfg.strategy.onBar(
      buildMultiAssetContext(
        date,
        engineData,
        stockPortfolio,
        futurePortfolio,
        collected,
        customFactors,
        allocation.stock > 0,
      ),
    );
    pendingTargets = collected.targets;
    pendingOrders = collected.orders;
    pendingFutureIntents = collected.futureIntents;
  }

  const trades = [...stockPortfolio.trades, ...futurePortfolio.trades].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  return summarize(cfg, nav, trades, engineData.indexCloses(BENCHMARK), sleeveNav);
}

function accountAllocation(cfg: EngineConfig): { stock: number; futures: number } {
  if (!cfg.strategy.accounts) {
    return { stock: 0, futures: 1 };
  }
  const stock = cfg.strategy.accounts.stock.cashWeight;
  const futures = cfg.strategy.accounts.futures.cashWeight;
  if (!Number.isFinite(stock) || !Number.isFinite(futures) || stock < 0 || futures < 0) {
    throw new Error('Account cash weights must be finite non-negative numbers');
  }
  if (Math.abs(stock + futures - 1) > 1e-9) {
    throw new Error('Stock and futures account cash weights must sum to 1');
  }
  return { stock, futures };
}

// —— helpers ——

/** YYYYMMDD → YYYY-MM-DD for log lines. */
function fmtDate(d: string): string {
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

/** Evaluate the host-prepared custom factor modules and bind them into a per-run runtime. Every
 * custom key the strategy DECLARES must have a module (the host couldn't find a deleted/foreign
 * factor row — fail loudly, not silent nulls). Inline ctx.factor('custom:…') reads of undeclared
 * keys simply see null, consistent with undeclared moneyflow columns. */
function buildCustomFactorRuntime(
  cfg: EngineConfig,
  engineData: EngineData,
  locale: Locale,
  log: (line: string) => void,
): CustomFactorRuntime | null {
  const declaredCustomKeys = (cfg.strategy.factors ?? []).filter(isCustomFactorKey);
  const modules = cfg.customFactors ?? [];
  if (declaredCustomKeys.length === 0 && modules.length === 0) {
    return null;
  }

  const providedKeys = new Set(modules.map((mod) => mod.key));
  const missing = declaredCustomKeys.filter((key) => !providedKeys.has(key));
  if (missing.length > 0) {
    throw new Error(t(locale, 'customFactorMissing', { keys: missing.join(', ') }));
  }

  const factors = new Map(modules.map((mod) => [mod.key, evaluateCustomFactorModule(mod)]));
  const warnedKeys = new Set<string>();
  return new CustomFactorRuntime(factors, engineData, (key, message) => {
    // First compute error per factor reaches the run log; later ones are dropped (same failure repeats per stock×day).
    if (!warnedKeys.has(key)) {
      warnedKeys.add(key);
      log(`[factor-error] ${key}: ${message}`);
    }
  });
}

function buildContext(
  date: string,
  engineData: EngineData,
  portfolio: Portfolio,
  collected: { targets: Map<string, number> | null; orders: Map<string, number> | null },
  customFactors: CustomFactorRuntime | null,
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
    get availableCash() {
      return portfolio.cash;
    },
    get stockValue() {
      return portfolio.equity((c) => engineData.closeAt(c, date));
    },
    get futureValue() {
      return 0;
    },
    get stockAvailableCash() {
      return portfolio.cash;
    },
    get futureAvailableCash() {
      return 0;
    },
    get futureMargin() {
      return 0;
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
      if (customFactors?.has(name)) {
        return customFactors.value(name, date, code, cross?.byCode.get(code) ?? null);
      }
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
    future() {
      return null;
    },
    futureHistory() {
      return [];
    },
    futurePosition() {
      return null;
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
    orderFuture() {
      throw new Error('Declare strategy.futures to use futures orders');
    },
    setFutureTargetContracts() {
      throw new Error('Declare strategy.futures to use futures orders');
    },
    setFutureTargetNotional() {
      throw new Error('Declare strategy.futures to use futures orders');
    },
    hedgeFuture() {
      throw new Error('Declare strategy.futures to use futures orders');
    },
    exitFuture() {
      throw new Error('Declare strategy.futures to use futures orders');
    },
  };
}

function buildMultiAssetContext(
  date: string,
  engineData: EngineData,
  stockPortfolio: Portfolio,
  futurePortfolio: FuturesPortfolio,
  collected: {
    targets: Map<string, number> | null;
    orders: Map<string, number> | null;
    futureIntents: Map<string, FutureIntent> | null;
  },
  customFactors: CustomFactorRuntime | null,
  stockOrdersEnabled: boolean,
): BarContext {
  let cross: CrossSection | null = null;
  return {
    date,
    get cash() {
      return stockPortfolio.cash + futurePortfolio.cash;
    },
    get value() {
      return stockPortfolio.equity((code) => engineData.closeAt(code, date)) + futurePortfolio.cash;
    },
    get availableCash() {
      return stockPortfolio.cash + futurePortfolio.availableCash;
    },
    get stockValue() {
      return stockPortfolio.equity((code) => engineData.closeAt(code, date));
    },
    get futureValue() {
      return futurePortfolio.cash;
    },
    get stockAvailableCash() {
      return stockPortfolio.cash;
    },
    get futureAvailableCash() {
      return futurePortfolio.availableCash;
    },
    get futureMargin() {
      return futurePortfolio.margin;
    },
    positions() {
      return [...stockPortfolio.positions].map(([code, position]) => ({
        code,
        shares: position.shares,
        avgCost: position.avgCost,
        marketValue: position.shares * (engineData.closeAt(code, date) ?? 0),
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
      if (customFactors?.has(name)) {
        return customFactors.value(name, date, code, cross?.byCode.get(code) ?? null);
      }
      return engineData.factor(name, date, code);
    },
    indexMembers(indexCode) {
      return engineData.indexMembers(indexCode, date);
    },
    index(indexCode) {
      return {
        get close() {
          return engineData.indexCloseAsOf(indexCode, date);
        },
        sma(n: number) {
          return engineData.indexSma(indexCode, date, n);
        },
      };
    },
    future(code) {
      return engineData.futureBar(code, date);
    },
    futureHistory(code, field, n) {
      return engineData.futureHistory(code, date, field, n);
    },
    futurePosition(code) {
      return futurePortfolio.position(code);
    },
    orderTargetPercent(code, weight) {
      assertStockOrdersEnabled(stockOrdersEnabled);
      collected.targets ??= new Map();
      collected.targets.set(code, weight);
    },
    setHoldings(weights) {
      assertStockOrdersEnabled(stockOrdersEnabled);
      collected.targets = new Map(weights instanceof Map ? weights : Object.entries(weights));
    },
    order(code, shares) {
      assertStockOrdersEnabled(stockOrdersEnabled);
      if (!shares) {
        return;
      }
      collected.orders ??= new Map();
      collected.orders.set(code, (collected.orders.get(code) ?? 0) + shares);
    },
    exit(code) {
      assertStockOrdersEnabled(stockOrdersEnabled);
      const held = stockPortfolio.positions.get(code)?.shares ?? 0;
      if (!held) {
        return;
      }
      collected.orders ??= new Map();
      collected.orders.set(code, (collected.orders.get(code) ?? 0) - held);
    },
    shares(code) {
      return stockPortfolio.positions.get(code)?.shares ?? 0;
    },
    orderFuture(code, contracts) {
      const roundedContracts = Math.trunc(contracts);
      if (!roundedContracts) {
        return;
      }
      collected.futureIntents ??= new Map();
      const prior = collected.futureIntents.get(code);
      const value = prior?.kind === 'delta' ? prior.value + roundedContracts : roundedContracts;
      collected.futureIntents.set(code, { kind: 'delta', value });
    },
    setFutureTargetContracts(code, contracts) {
      collected.futureIntents ??= new Map();
      collected.futureIntents.set(code, { kind: 'contracts', value: Math.trunc(contracts) });
    },
    setFutureTargetNotional(code, notional) {
      collected.futureIntents ??= new Map();
      collected.futureIntents.set(code, { kind: 'notional', value: notional });
    },
    hedgeFuture(code, beta = 1) {
      collected.futureIntents ??= new Map();
      collected.futureIntents.set(code, { kind: 'hedge', value: beta });
    },
    exitFuture(code) {
      collected.futureIntents ??= new Map();
      collected.futureIntents.set(code, { kind: 'contracts', value: 0 });
    },
  };
}

function assertStockOrdersEnabled(enabled: boolean): void {
  if (!enabled) {
    throw new Error('Stock orders require a positive strategy.accounts.stock.cashWeight');
  }
}

function executeFutureIntents(
  futurePortfolio: FuturesPortfolio,
  stockPortfolio: Portfolio,
  engineData: EngineData,
  date: string,
  mappingDate: string,
  intents: Map<string, FutureIntent>,
): void {
  const stockExposure = stockPortfolio.marketValue(
    (code) => engineData.openAt(code, date) ?? engineData.closeAt(code, date),
  );
  for (const [code, intent] of intents) {
    const current = futurePortfolio.position(code)?.contracts ?? 0;
    if (intent.kind === 'delta') {
      futurePortfolio.order(engineData, code, intent.value, date, mappingDate);
      continue;
    }
    let target = intent.value;
    if (intent.kind === 'notional' || intent.kind === 'hedge') {
      const desiredNotional =
        intent.kind === 'hedge' ? -intent.value * stockExposure : intent.value;
      target = futureContractsForNotional(engineData, code, desiredNotional, date, mappingDate);
    }
    const delta = Math.trunc(target) - current;
    if (delta !== 0) {
      futurePortfolio.order(engineData, code, delta, date, mappingDate);
    }
  }
}

function futureContractsForNotional(
  engineData: EngineData,
  code: string,
  notional: number,
  date: string,
  mappingDate: string,
): number {
  const actualCode = engineData.futureExecutionCode(code, mappingDate, date);
  if (!actualCode) {
    return 0;
  }
  const bar = engineData.futureActualBar(actualCode, date);
  if (bar?.open == null || bar.open <= 0 || bar.multiplier <= 0) {
    return 0;
  }
  return Math.round(notional / (bar.open * bar.multiplier));
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
  sleeveNav?: SleeveNavPoint[],
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
    monthly,
  };
}

function stockTradePnl(tradeLog: BacktestResult['tradeLog']): number[] {
  const book = new Map<string, { shares: number; cost: number }>();
  const realized: number[] = [];
  for (const trade of tradeLog) {
    const position = book.get(trade.code) ?? { shares: 0, cost: 0 };
    if (trade.side === 'buy') {
      position.shares += trade.realShares;
      position.cost += trade.amount + trade.fee;
    } else {
      const averageCost = position.shares > 0 ? position.cost / position.shares : 0;
      const costOut = averageCost * trade.realShares;
      realized.push(trade.amount - trade.fee - costOut);
      position.shares -= trade.realShares;
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

function futuresTradePnl(tradeLog: BacktestResult['tradeLog']): number[] {
  const book = new Map<string, { contracts: number; averagePrice: number; entryFees: number }>();
  const realized: number[] = [];
  for (const trade of tradeLog) {
    const delta = (trade.side === 'buy' ? 1 : -1) * (trade.contracts ?? trade.realShares);
    const multiplier = trade.multiplier ?? 1;
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
