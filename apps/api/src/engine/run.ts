import { DEFAULT_LOCALE, isComputedFactorKey, type Locale } from '@jixie/shared';
import * as st from '../lib/stats.js';
import { t } from '../i18n/messages.js'; // direct import — keeps hono/locale out of the wall bundle
import { CSI_300_TOTAL_RETURN_INDEX_CODE } from '../store/index-presets.js';
import { EngineData, type CrossSection } from './data.js';
import { CustomFactorRuntime, evaluateCustomFactorModule } from './custom-factor.js';
import { prismaDataPort } from './prisma-port.js';
import { Portfolio } from './portfolio.js';
import { FuturesPortfolio } from './futures-portfolio.js';
import {
  AllocationAnalysisTracker,
  allocationAssetClasses,
  classifyAllocationRateRegime,
} from './allocation-analysis.js';
import {
  DEFAULT_COST,
  type BacktestResult,
  type BarContext,
  type ConditionalOrderKind,
  type CostModel,
  type EngineConfig,
  type PendingCashSignal,
  type PendingConditionalSignal,
  type SignalBacktestOutput,
  type SleeveNavPoint,
  type StrategySignalCapture,
} from './types.js';

type FutureIntent =
  | { kind: 'delta'; value: number }
  | { kind: 'contracts'; value: number }
  | { kind: 'notional'; value: number }
  | { kind: 'hedge'; value: number };

type ConditionalOrder =
  | {
      kind: 'stop_loss';
      code: string;
      triggerPrice: number;
      placedDate: string;
    }
  | {
      kind: 'trailing_stop';
      code: string;
      trailingPct: number;
      highWater: number;
      placedDate: string;
    }
  | {
      kind: 'limit_buy';
      code: string;
      triggerPrice: number;
      shares: number;
      placedDate: string;
    }
  | {
      kind: 'take_profit';
      code: string;
      triggerPrice: number;
      placedDate: string;
    };

type ConditionalCommand =
  | {
      action: 'upsert';
      order:
        | { kind: 'stop_loss'; code: string; triggerPrice: number }
        | { kind: 'trailing_stop'; code: string; trailingPct: number; highWater: number }
        | { kind: 'limit_buy'; code: string; triggerPrice: number; shares: number }
        | { kind: 'take_profit'; code: string; triggerPrice: number };
    }
  | { action: 'cancel'; code: string; kind?: ConditionalOrderKind };

type CollectedStockOrders = {
  targets: Map<string, number> | null;
  orders: Map<string, number> | null;
  lotOrders: Map<string, number> | null;
  conditionalCommands: ConditionalCommand[];
};

const PERIODS_PER_YEAR = 252; // trading days
const BENCHMARK = CSI_300_TOTAL_RETURN_INDEX_CODE; // matches adjusted strategy NAV
const MAX_SLIP = 0.1; // cap slippage at 10% so a huge order in an illiquid name can't produce absurd fills

function needsTurnoverRateFHistory(cfg: EngineConfig): boolean {
  return (cfg.customFactors ?? []).some((factor) =>
    factor.historyFields?.includes('turnoverRateF'),
  );
}

function needsGovernmentYieldCurve(cfg: EngineConfig): boolean {
  return (cfg.customFactors ?? []).some((factor) =>
    factor.assetSeries?.inputs.some((field) => field.startsWith('rates.cgb.yield.')),
  );
}

function needsFundamentalHistory(cfg: EngineConfig): boolean {
  return (cfg.customFactors ?? []).some((factor) =>
    factor.historyFields?.some((field) => field === 'roe' || field === 'grossprofitMargin'),
  );
}

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
  validateEngineConfig(cfg);
  if (cfg.strategy.futures?.length) {
    return runMultiAssetStrategy(cfg);
  }
  return (await runStockStrategyCore(cfg, false)).result;
}

/** Run a stock/ETF strategy and retain its final next-open intent for daily signal generation. */
export async function runStrategyWithSignals(cfg: EngineConfig): Promise<SignalBacktestOutput> {
  validateEngineConfig(cfg);
  if (cfg.strategy.futures?.length) {
    throw new Error('Daily signals currently support stock and ETF strategies only');
  }
  const output = await runStockStrategyCore(cfg, true);
  if (!output.capture) {
    throw new Error('Signal capture was not produced');
  }
  return { result: output.result, capture: output.capture };
}

async function runStockStrategyCore(
  cfg: EngineConfig,
  captureSignals: boolean,
): Promise<{ result: BacktestResult; capture: StrategySignalCapture | null }> {
  const cost = { ...DEFAULT_COST, ...cfg.cost };
  const locale = cfg.locale ?? DEFAULT_LOCALE;
  const log = cfg.onLog ?? (() => {}); // progress sink (worker forwards to the job; scripts no-op)
  const allocationClasses = allocationAssetClasses(cfg.customFactors);
  const engineData = new EngineData(
    cfg.start,
    cfg.end,
    cfg.strategy.factors ?? [],
    log,
    locale,
    cfg.dataPort ?? prismaDataPort,
    [],
    needsTurnoverRateFHistory(cfg),
    needsGovernmentYieldCurve(cfg) || allocationClasses.size > 0,
  );
  await engineData.load();
  if (cfg.strategy.watch?.length) {
    await engineData.loadBars(cfg.strategy.watch);
  } // per-instrument preload
  if (needsFundamentalHistory(cfg)) {
    await engineData.preloadFina();
  } // custom-factor 'roe' histories read fina synchronously
  if (allocationClasses.size > 0) {
    await engineData.loadBars([...allocationClasses.keys()]);
  }
  const customFactors = buildCustomFactorRuntime(cfg, engineData, locale, log);
  const portfolio = new Portfolio(cfg.initialCash, cost);
  const allocationTracker =
    allocationClasses.size > 0
      ? new AllocationAnalysisTracker(cfg.initialCash, allocationClasses)
      : null;

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
  let pendingTargetDecisionDate: string | null = null;
  let pendingOrders: Map<string, number> | null = null;
  let pendingLotOrders: Map<string, number> | null = null;
  const conditionalOrders = new Map<string, ConditionalOrder>();
  const factorObservations = new Map<string, Map<string, number | null>>();
  let lastYear = '';
  const total = engineData.timeline.length;
  let capturedTrades = 0;

  for (let i = 0; i < total; i++) {
    const date = engineData.timeline[i];
    assertNoDelistedPositions(portfolio, engineData, date);
    const heldBeforeOpen = new Set(portfolio.positions.keys());
    // 1. Execute what was queued yesterday, at today's open (declarative rebalance OR share orders).
    if (pendingTargets) {
      const codes = new Set<string>([...pendingTargets.keys(), ...portfolio.positions.keys()]);
      await engineData.loadBars([...codes]); // ensure bars before fills/marking
      const preTrade = allocationTracker?.weights(
        portfolio.cash,
        portfolio.positions,
        (code) => engineData.openAt(code, date) ?? engineData.closeAt(code, date),
      );
      rebalance(portfolio, engineData, date, pendingTargets, cost);
      if (allocationTracker && preTrade && pendingTargetDecisionDate) {
        allocationTracker.captureRebalance({
          decisionDate: pendingTargetDecisionDate,
          executionDate: date,
          targets: pendingTargets,
          preTrade,
          postTrade: allocationTracker.weights(
            portfolio.cash,
            portfolio.positions,
            (code) => engineData.openAt(code, date) ?? engineData.closeAt(code, date),
          ),
        });
      }
      pendingTargets = null;
      pendingTargetDecisionDate = null;
      log(t(locale, 'backtestRebalance', { date: fmtDate(date), count: portfolio.positions.size }));
    }
    if (pendingOrders || pendingLotOrders) {
      const codes = new Set([
        ...(pendingOrders?.keys() ?? []),
        ...(pendingLotOrders?.keys() ?? []),
      ]);
      await engineData.loadBars([...codes]);
      executeOrders(
        portfolio,
        engineData,
        date,
        mergeShareAndLotOrders(engineData, date, pendingOrders, pendingLotOrders),
        cost,
      );
      pendingOrders = null;
      pendingLotOrders = null;
    }
    removeConditionsForClosedPositions(conditionalOrders, heldBeforeOpen, portfolio);
    if (conditionalOrders.size > 0) {
      await engineData.loadBars([...new Set([...conditionalOrders.values()].map((o) => o.code))]);
      executeConditionalOrders(portfolio, engineData, date, conditionalOrders, cost);
    }

    // 2. Mark equity at today's close.
    const value = portfolio.equity((c) => engineData.closeAt(c, date));
    nav.push({ date, value });
    allocationTracker?.captureDay({
      date,
      value,
      positions: portfolio.positions,
      closeOf: (code) => engineData.closeAt(code, date),
      exactCloseOf: (code) => engineData.ohlcAt(code, date)?.close ?? null,
      trades: portfolio.trades.slice(capturedTrades),
      rateRegime: classifyAllocationRateRegime(
        date,
        engineData.governmentYieldHistoryAsOf(10, date, 252),
        engineData.governmentYieldHistoryAsOf(2, date, 252),
      ),
    });
    capturedTrades = portfolio.trades.length;

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
    const collected: CollectedStockOrders = {
      targets: null,
      orders: null,
      lotOrders: null,
      conditionalCommands: [],
    };
    const observeFactor =
      captureSignals && i === total - 1
        ? (key: string, code: string, value: number | null) => {
            if (!isComputedFactorKey(key)) {
              return;
            }
            const byCode = factorObservations.get(key) ?? new Map<string, number | null>();
            byCode.set(code, value);
            factorObservations.set(key, byCode);
          }
        : undefined;
    await customFactors?.prepare(date, cfg.strategy.watch ?? []);
    await cfg.strategy.onBar(
      buildContext(date, engineData, portfolio, collected, customFactors, observeFactor),
    );
    validateTargetBook(collected.targets);
    if (collected.targets) {
      pendingTargets = collected.targets;
      pendingTargetDecisionDate = date;
    }
    if (collected.orders) {
      pendingOrders = collected.orders;
    }
    if (collected.lotOrders) {
      pendingLotOrders = collected.lotOrders;
    }
    applyConditionalCommands(conditionalOrders, collected.conditionalCommands, date);
  }

  const capture = captureSignals
    ? await capturePendingCashSignals(
        engineData,
        portfolio,
        pendingTargets,
        pendingOrders,
        pendingLotOrders,
        conditionalOrders,
        factorObservations,
        nav.at(-1)?.date,
      )
    : null;
  const bench = engineData.indexCloses(BENCHMARK);
  const result = summarize(cfg, nav, portfolio.trades, bench, cost);
  if (allocationTracker) {
    result.allocationAnalysis = allocationTracker.finish(result.finalValue);
  }
  log(
    t(locale, 'backtestDone', {
      days: result.days,
      trades: result.trades,
      finalValue: yuan(result.finalValue),
      ret: (result.totalReturn * 100).toFixed(2),
    }),
  );
  return { result, capture };
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
    needsTurnoverRateFHistory(cfg),
    needsGovernmentYieldCurve(cfg),
  );
  await engineData.load();
  if (cfg.strategy.watch?.length) {
    await engineData.loadBars(cfg.strategy.watch);
  }
  if (needsFundamentalHistory(cfg)) {
    await engineData.preloadFina();
  }
  const customFactors = buildCustomFactorRuntime(cfg, engineData, locale, log);
  const allocation = accountAllocation(cfg);
  const stockPortfolio = new Portfolio(cfg.initialCash * allocation.stock, cost);
  const futurePortfolio = new FuturesPortfolio(cfg.initialCash * allocation.futures, cost);
  const nav: { date: string; value: number }[] = [];
  const sleeveNav: SleeveNavPoint[] = [];
  let pendingTargets: Map<string, number> | null = null;
  let pendingOrders: Map<string, number> | null = null;
  let pendingLotOrders: Map<string, number> | null = null;
  let pendingFutureIntents: Map<string, FutureIntent> | null = null;
  const conditionalOrders = new Map<string, ConditionalOrder>();

  for (let index = 0; index < engineData.timeline.length; index++) {
    const date = engineData.timeline[index];
    assertNoDelistedPositions(stockPortfolio, engineData, date);
    const previousDate = engineData.timeline[index - 1];
    if (previousDate) {
      const heldBeforeOpen = new Set(stockPortfolio.positions.keys());
      futurePortfolio.roll(
        engineData,
        date,
        previousDate,
        new Set(pendingFutureIntents?.keys() ?? []),
      );
      if (pendingTargets) {
        const codes = new Set<string>([
          ...pendingTargets.keys(),
          ...stockPortfolio.positions.keys(),
        ]);
        await engineData.loadBars([...codes]);
        rebalance(stockPortfolio, engineData, date, pendingTargets, cost);
        pendingTargets = null;
      }
      if (pendingOrders || pendingLotOrders) {
        const codes = new Set([
          ...(pendingOrders?.keys() ?? []),
          ...(pendingLotOrders?.keys() ?? []),
        ]);
        await engineData.loadBars([...codes]);
        executeOrders(
          stockPortfolio,
          engineData,
          date,
          mergeShareAndLotOrders(engineData, date, pendingOrders, pendingLotOrders),
          cost,
        );
        pendingOrders = null;
        pendingLotOrders = null;
      }
      removeConditionsForClosedPositions(conditionalOrders, heldBeforeOpen, stockPortfolio);
      if (conditionalOrders.size > 0) {
        await engineData.loadBars([
          ...new Set([...conditionalOrders.values()].map((order) => order.code)),
        ]);
        executeConditionalOrders(stockPortfolio, engineData, date, conditionalOrders, cost);
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
      lotOrders: null as Map<string, number> | null,
      conditionalCommands: [] as ConditionalCommand[],
      futureIntents: null as Map<string, FutureIntent> | null,
    };
    await customFactors?.prepare(date, cfg.strategy.watch ?? []);
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
    validateTargetBook(collected.targets);
    pendingTargets = collected.targets;
    pendingOrders = collected.orders;
    pendingLotOrders = collected.lotOrders;
    pendingFutureIntents = collected.futureIntents;
    applyConditionalCommands(conditionalOrders, collected.conditionalCommands, date);
  }

  const trades = [...stockPortfolio.trades, ...futurePortfolio.trades].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  return summarize(cfg, nav, trades, engineData.indexCloses(BENCHMARK), cost, sleeveNav);
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

function validateEngineConfig(cfg: EngineConfig): void {
  if (!/^\d{8}$/.test(cfg.start) || !/^\d{8}$/.test(cfg.end) || cfg.start > cfg.end) {
    throw new Error('Backtest dates must be valid YYYYMMDD values with start no later than end');
  }
  if (!Number.isFinite(cfg.initialCash) || cfg.initialCash <= 0) {
    throw new Error('Initial cash must be a positive finite number');
  }
  for (const [key, value] of Object.entries(cfg.strategy.params ?? {})) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`Strategy parameter ${key} must be finite`);
    }
  }
  const cost = { ...DEFAULT_COST, ...cfg.cost };
  for (const [key, value] of Object.entries(cost)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Cost setting ${key} must be a finite non-negative number`);
    }
  }
  if (cost.futureMarginRate <= 0 || cost.futureMarginRate > 1) {
    throw new Error('Cost setting futureMarginRate must be between 0 and 1');
  }
}

function validateTargetWeight(code: string, weight: number): void {
  if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
    throw new Error(`Target weight for ${code} must be a finite number between 0 and 1`);
  }
}

function validateTargetBook(targets: Map<string, number> | null): void {
  if (!targets) {
    return;
  }
  let total = 0;
  for (const [code, weight] of targets) {
    validateTargetWeight(code, weight);
    total += weight;
  }
  if (total > 1 + 1e-9) {
    throw new Error(`Target weights must sum to at most 1; received ${total}`);
  }
}

function assertNoDelistedPositions(
  portfolio: Portfolio,
  engineData: EngineData,
  date: string,
): void {
  for (const code of portfolio.positions.keys()) {
    const delistDate = engineData.delistedBefore(code, date);
    if (delistDate) {
      throw new Error(
        `Cannot value delisted position ${code} on ${date}; final listing date was ${delistDate}`,
      );
    }
  }
}

// —— helpers ——

/** YYYYMMDD → YYYY-MM-DD for log lines. */
function fmtDate(d: string): string {
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

/** Evaluate the host-prepared custom factor modules and bind them into a per-run runtime. Every
 * custom key the strategy DECLARES must have a module (the host couldn't find a deleted/foreign
 * factor row — fail loudly, not silent nulls). Inline ctx.factor() reads of undeclared
 * keys simply see null, consistent with undeclared moneyflow columns. */
function buildCustomFactorRuntime(
  cfg: EngineConfig,
  engineData: EngineData,
  locale: Locale,
  log: (line: string) => void,
): CustomFactorRuntime | null {
  const declaredCustomKeys = (cfg.strategy.factors ?? []).filter(isComputedFactorKey);
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
  return new CustomFactorRuntime(factors, engineData, cfg.strategy.watch ?? [], (key, message) => {
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
  collected: CollectedStockOrders,
  customFactors: CustomFactorRuntime | null,
  onFactorRead?: (key: string, code: string, value: number | null) => void,
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
      await customFactors?.prepare(date, cross.codes, cross.byCode);
      return cross.codes;
    },
    bar(code) {
      return cross?.byCode.get(code) ?? null;
    },
    bars(code, n) {
      return engineData.bars(code, date, n);
    },
    resampledBars(code, period, n) {
      return engineData.resampledBars(code, date, period, n);
    },
    ensureBars(codes) {
      return engineData.loadBars(codes);
    },
    listDays(code) {
      return engineData.listDays(code, date);
    },
    industry(code) {
      return engineData.industry(code, date);
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
      const value = customFactors?.has(name)
        ? customFactors.value(name, date, code, cross?.byCode.get(code) ?? null)
        : engineData.factor(name, date, code);
      onFactorRead?.(name, code, value);
      return value;
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
        get pe() {
          return engineData.indexValuationAsOf(indexCode, date, 'pe');
        },
        get peTtm() {
          return engineData.indexValuationAsOf(indexCode, date, 'peTtm');
        },
        get pb() {
          return engineData.indexValuationAsOf(indexCode, date, 'pb');
        },
        sma(n: number) {
          return engineData.indexSma(indexCode, date, n);
        },
        percentile(field, lookback) {
          return engineData.indexValuationPercentile(indexCode, date, field, lookback);
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
      validateTargetWeight(code, weight);
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
        validateTargetWeight(code, weight);
        targetWeights.set(code, weight);
      }
      validateTargetBook(targetWeights);
      collected.targets = targetWeights;
    },
    order(code, shares) {
      assertFiniteOrderValue(shares, 'Order shares');
      if (!shares) {
        return;
      }
      if (collected.orders == null) {
        collected.orders = new Map();
      }
      collected.orders.set(code, (collected.orders.get(code) ?? 0) + shares);
    },
    orderLots(code, lots) {
      assertFiniteOrderValue(lots, 'Order lots');
      const wholeLots = Math.trunc(lots);
      if (!wholeLots) {
        return;
      }
      collected.lotOrders ??= new Map();
      collected.lotOrders.set(code, (collected.lotOrders.get(code) ?? 0) + wholeLots);
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
    stopLoss(code, price) {
      assertPositiveOrderValue(price, 'Stop-loss price');
      collected.conditionalCommands.push({
        action: 'upsert',
        order: { kind: 'stop_loss', code, triggerPrice: price },
      });
    },
    trailingStop(code, pct) {
      assertFraction(pct, 'Trailing-stop percentage');
      const highWater = engineData.closeAt(code, date);
      if (highWater == null || highWater <= 0) {
        return;
      }
      collected.conditionalCommands.push({
        action: 'upsert',
        order: { kind: 'trailing_stop', code, trailingPct: pct, highWater },
      });
    },
    limitBuy(code, price, shares) {
      assertPositiveOrderValue(price, 'Limit-buy price');
      assertPositiveOrderValue(shares, 'Limit-buy shares');
      collected.conditionalCommands.push({
        action: 'upsert',
        order: { kind: 'limit_buy', code, triggerPrice: price, shares },
      });
    },
    takeProfit(code, pct) {
      assertPositiveOrderValue(pct, 'Take-profit percentage');
      const position = portfolio.positions.get(code);
      if (!position) {
        return;
      }
      collected.conditionalCommands.push({
        action: 'upsert',
        order: {
          kind: 'take_profit',
          code,
          triggerPrice: position.avgCost * (1 + pct),
        },
      });
    },
    cancelConditional(code, kind) {
      collected.conditionalCommands.push({ action: 'cancel', code, kind });
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
    lotOrders: Map<string, number> | null;
    conditionalCommands: ConditionalCommand[];
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
      await customFactors?.prepare(date, cross.codes, cross.byCode);
      return cross.codes;
    },
    bar(code) {
      return cross?.byCode.get(code) ?? null;
    },
    bars(code, n) {
      return engineData.bars(code, date, n);
    },
    resampledBars(code, period, n) {
      return engineData.resampledBars(code, date, period, n);
    },
    ensureBars(codes) {
      return engineData.loadBars(codes);
    },
    listDays(code) {
      return engineData.listDays(code, date);
    },
    industry(code) {
      return engineData.industry(code, date);
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
        get pe() {
          return engineData.indexValuationAsOf(indexCode, date, 'pe');
        },
        get peTtm() {
          return engineData.indexValuationAsOf(indexCode, date, 'peTtm');
        },
        get pb() {
          return engineData.indexValuationAsOf(indexCode, date, 'pb');
        },
        sma(n: number) {
          return engineData.indexSma(indexCode, date, n);
        },
        percentile(field, lookback) {
          return engineData.indexValuationPercentile(indexCode, date, field, lookback);
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
      validateTargetWeight(code, weight);
      collected.targets ??= new Map();
      collected.targets.set(code, weight);
    },
    setHoldings(weights) {
      assertStockOrdersEnabled(stockOrdersEnabled);
      const targetWeights = new Map(weights instanceof Map ? weights : Object.entries(weights));
      validateTargetBook(targetWeights);
      collected.targets = targetWeights;
    },
    order(code, shares) {
      assertStockOrdersEnabled(stockOrdersEnabled);
      assertFiniteOrderValue(shares, 'Order shares');
      if (!shares) {
        return;
      }
      collected.orders ??= new Map();
      collected.orders.set(code, (collected.orders.get(code) ?? 0) + shares);
    },
    orderLots(code, lots) {
      assertStockOrdersEnabled(stockOrdersEnabled);
      assertFiniteOrderValue(lots, 'Order lots');
      const wholeLots = Math.trunc(lots);
      if (!wholeLots) {
        return;
      }
      collected.lotOrders ??= new Map();
      collected.lotOrders.set(code, (collected.lotOrders.get(code) ?? 0) + wholeLots);
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
    stopLoss(code, price) {
      assertStockOrdersEnabled(stockOrdersEnabled);
      assertPositiveOrderValue(price, 'Stop-loss price');
      collected.conditionalCommands.push({
        action: 'upsert',
        order: { kind: 'stop_loss', code, triggerPrice: price },
      });
    },
    trailingStop(code, pct) {
      assertStockOrdersEnabled(stockOrdersEnabled);
      assertFraction(pct, 'Trailing-stop percentage');
      const highWater = engineData.closeAt(code, date);
      if (highWater == null || highWater <= 0) {
        return;
      }
      collected.conditionalCommands.push({
        action: 'upsert',
        order: { kind: 'trailing_stop', code, trailingPct: pct, highWater },
      });
    },
    limitBuy(code, price, shares) {
      assertStockOrdersEnabled(stockOrdersEnabled);
      assertPositiveOrderValue(price, 'Limit-buy price');
      assertPositiveOrderValue(shares, 'Limit-buy shares');
      collected.conditionalCommands.push({
        action: 'upsert',
        order: { kind: 'limit_buy', code, triggerPrice: price, shares },
      });
    },
    takeProfit(code, pct) {
      assertStockOrdersEnabled(stockOrdersEnabled);
      assertPositiveOrderValue(pct, 'Take-profit percentage');
      const position = stockPortfolio.positions.get(code);
      if (!position) {
        return;
      }
      collected.conditionalCommands.push({
        action: 'upsert',
        order: {
          kind: 'take_profit',
          code,
          triggerPrice: position.avgCost * (1 + pct),
        },
      });
    },
    cancelConditional(code, kind) {
      assertStockOrdersEnabled(stockOrdersEnabled);
      collected.conditionalCommands.push({ action: 'cancel', code, kind });
    },
    shares(code) {
      return stockPortfolio.positions.get(code)?.shares ?? 0;
    },
    orderFuture(code, contracts) {
      assertFiniteOrderValue(contracts, 'Futures contracts');
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
      assertFiniteOrderValue(contracts, 'Futures target contracts');
      collected.futureIntents ??= new Map();
      collected.futureIntents.set(code, { kind: 'contracts', value: Math.trunc(contracts) });
    },
    setFutureTargetNotional(code, notional) {
      assertFiniteOrderValue(notional, 'Futures target notional');
      collected.futureIntents ??= new Map();
      collected.futureIntents.set(code, { kind: 'notional', value: notional });
    },
    hedgeFuture(code, beta = 1) {
      if (!Number.isFinite(beta) || beta < 0) {
        throw new Error('Futures hedge beta must be a finite non-negative number');
      }
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

function assertPositiveOrderValue(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number`);
  }
}

function assertFiniteOrderValue(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be finite`);
  }
}

function assertFraction(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new Error(`${label} must be between 0 and 1`);
  }
}

function conditionalOrderKey(kind: ConditionalOrderKind, code: string): string {
  return `${kind}:${code}`;
}

function removeConditionsForClosedPositions(
  book: Map<string, ConditionalOrder>,
  heldBeforeOpen: Set<string>,
  portfolio: Portfolio,
): void {
  for (const code of heldBeforeOpen) {
    if (portfolio.positions.has(code)) {
      continue;
    }
    for (const [key, order] of book) {
      if (order.code === code && order.kind !== 'limit_buy') {
        book.delete(key);
      }
    }
  }
}

function applyConditionalCommands(
  book: Map<string, ConditionalOrder>,
  commands: ConditionalCommand[],
  placedDate: string,
): void {
  for (const command of commands) {
    if (command.action === 'cancel') {
      if (command.kind) {
        book.delete(conditionalOrderKey(command.kind, command.code));
      } else {
        for (const [key, order] of book) {
          if (order.code === command.code) {
            book.delete(key);
          }
        }
      }
      continue;
    }

    const key = conditionalOrderKey(command.order.kind, command.order.code);
    const existing = book.get(key);
    if (command.order.kind === 'trailing_stop') {
      book.set(key, {
        ...command.order,
        highWater:
          existing?.kind === 'trailing_stop'
            ? Math.max(existing.highWater, command.order.highWater)
            : command.order.highWater,
        placedDate: existing?.placedDate ?? placedDate,
      });
    } else {
      book.set(key, { ...command.order, placedDate });
    }
  }
}

/** Execute persistent conditions against one exact daily OHLC bar. Stop exits are evaluated before
 * profit exits when both ends of the range were touched because daily data cannot reveal which came
 * first; choosing the adverse branch avoids optimistic path assumptions. Trailing stops use only the
 * high-water mark known before this bar, then advance it after evaluation. */
function executeConditionalOrders(
  portfolio: Portfolio,
  engineData: EngineData,
  date: string,
  book: Map<string, ConditionalOrder>,
  cost: CostModel,
): void {
  const byCode = new Map<string, ConditionalOrder[]>();
  for (const order of book.values()) {
    const orders = byCode.get(order.code) ?? [];
    orders.push(order);
    byCode.set(order.code, orders);
  }

  for (const [code, orders] of byCode) {
    const bar = engineData.ohlcAt(code, date);
    if (!bar) {
      continue;
    }

    const position = portfolio.positions.get(code);
    const sellableShares = portfolio.sellableShares(code, date);
    const stopCandidates: Array<{
      order: Extract<ConditionalOrder, { kind: 'stop_loss' | 'trailing_stop' }>;
      triggerPrice: number;
    }> = [];
    for (const order of orders) {
      if (order.kind === 'stop_loss' && bar.low <= order.triggerPrice) {
        stopCandidates.push({ order, triggerPrice: order.triggerPrice });
      } else if (order.kind === 'trailing_stop') {
        const triggerPrice = order.highWater * (1 - order.trailingPct);
        if (bar.low <= triggerPrice) {
          stopCandidates.push({ order, triggerPrice });
        }
      }
    }
    stopCandidates.sort((left, right) => right.triggerPrice - left.triggerPrice);
    const takeProfit = orders.find(
      (order): order is Extract<ConditionalOrder, { kind: 'take_profit' }> =>
        order.kind === 'take_profit' && bar.high >= order.triggerPrice,
    );
    const exitCandidate: {
      order: Extract<ConditionalOrder, { kind: 'stop_loss' | 'trailing_stop' | 'take_profit' }>;
      triggerPrice: number;
    } | null =
      stopCandidates.length > 0
        ? stopCandidates[0]
        : takeProfit
          ? { order: takeProfit, triggerPrice: takeProfit.triggerPrice }
          : null;

    if (
      sellableShares > 0 &&
      position &&
      exitCandidate &&
      !conditionalLimitBlocked(engineData, code, date, 'sell', bar)
    ) {
      const isProfit = exitCandidate.order.kind === 'take_profit';
      const basePrice = isProfit
        ? bar.open >= exitCandidate.triggerPrice
          ? bar.open
          : exitCandidate.triggerPrice
        : bar.open <= exitCandidate.triggerPrice
          ? bar.open
          : exitCandidate.triggerPrice;
      const slippedPrice = execPrice(
        engineData,
        code,
        date,
        'sell',
        basePrice,
        sellableShares * basePrice,
        cost,
      );
      const fillPrice = isProfit
        ? Math.max(exitCandidate.triggerPrice, slippedPrice)
        : slippedPrice;
      portfolio.fill(
        code,
        -sellableShares,
        fillPrice,
        date,
        sellableFromFor(engineData, code, date),
        engineData.adjAt(code, date)!,
        engineData.assetType(code),
        basePrice,
      );
      if (!portfolio.positions.has(code)) {
        for (const order of orders) {
          if (order.kind !== 'limit_buy') {
            book.delete(conditionalOrderKey(order.kind, code));
          }
        }
      }
    }

    for (const order of orders) {
      if (order.kind !== 'limit_buy' || bar.low > order.triggerPrice) {
        continue;
      }
      if (conditionalLimitBlocked(engineData, code, date, 'buy', bar)) {
        continue;
      }
      const basePrice = bar.open <= order.triggerPrice ? bar.open : order.triggerPrice;
      const slippedPrice = execPrice(
        engineData,
        code,
        date,
        'buy',
        basePrice,
        order.shares * basePrice,
        cost,
      );
      const fillPrice = Math.min(order.triggerPrice, slippedPrice);
      const adjustmentFactor = engineData.adjAt(code, date)!;
      const buy = Math.min(
        order.shares,
        portfolio.affordableShares(fillPrice, engineData.assetType(code), adjustmentFactor),
      );
      if (buy <= 0) {
        continue;
      }
      portfolio.fill(
        code,
        buy,
        fillPrice,
        date,
        sellableFromFor(engineData, code, date),
        adjustmentFactor,
        engineData.assetType(code),
        basePrice,
      );
      book.delete(conditionalOrderKey(order.kind, code));
    }

    for (const order of orders) {
      if (order.kind === 'trailing_stop' && book.has(conditionalOrderKey(order.kind, code))) {
        order.highWater = Math.max(order.highWater, bar.high);
      }
    }
  }
}

function conditionalLimitBlocked(
  engineData: EngineData,
  code: string,
  date: string,
  side: 'buy' | 'sell',
  bar: { high: number; low: number },
): boolean {
  const limit = engineData.limitAt(code, date);
  const adjustmentFactor = engineData.adjAt(code, date);
  if (!limit || !adjustmentFactor || adjustmentFactor <= 0) {
    return false;
  }
  const epsilon = 1e-3;
  return side === 'buy'
    ? limit.up != null && bar.low / adjustmentFactor >= limit.up - epsilon
    : limit.down != null && bar.high / adjustmentFactor <= limit.down + epsilon;
}

async function capturePendingCashSignals(
  engineData: EngineData,
  portfolio: Portfolio,
  pendingTargets: Map<string, number> | null,
  pendingOrders: Map<string, number> | null,
  pendingLotOrders: Map<string, number> | null,
  conditionalOrders: Map<string, ConditionalOrder>,
  factorObservations: Map<string, Map<string, number | null>>,
  tradeDate?: string,
): Promise<StrategySignalCapture> {
  if (!tradeDate) {
    throw new Error('Cannot capture signals from an empty trading range');
  }

  const codes = new Set<string>([
    ...portfolio.positions.keys(),
    ...(pendingTargets?.keys() ?? []),
    ...(pendingOrders?.keys() ?? []),
    ...(pendingLotOrders?.keys() ?? []),
    ...[...conditionalOrders.values()].map((order) => order.code),
  ]);
  await engineData.loadBars([...codes]);

  const modelEquity = portfolio.equity((code) => engineData.closeAt(code, tradeDate));
  const modelPositions = [...portfolio.positions].flatMap(([code, position]) => {
    const adjustmentFactor = engineData.adjAsOf(code, tradeDate);
    const markPrice = engineData.rawCloseAsOf(code, tradeDate);
    if (!adjustmentFactor || !markPrice) {
      return [];
    }
    return [
      {
        code,
        assetType: engineData.assetType(code),
        shares: position.shares * adjustmentFactor,
        markPrice,
        sellableFrom: position.frozenUntil,
        frozenShares:
          position.frozenUntil > tradeDate
            ? (position.frozenShares ?? position.shares) * adjustmentFactor
            : 0,
      },
    ];
  });
  const signals: Array<PendingCashSignal | PendingConditionalSignal> = [];

  if (pendingTargets) {
    const targetCodes = new Set([...portfolio.positions.keys(), ...pendingTargets.keys()]);
    for (const code of targetCodes) {
      const adjustedClose = engineData.closeAt(code, tradeDate);
      const adjustmentFactor = engineData.adjAsOf(code, tradeDate);
      const refPrice = engineData.rawCloseAsOf(code, tradeDate);
      if (adjustedClose == null || adjustedClose <= 0 || !adjustmentFactor || !refPrice) {
        continue;
      }

      const targetWeight = pendingTargets.get(code) ?? 0;
      const targetShares = (targetWeight * modelEquity) / adjustedClose;
      const currentShares = portfolio.positions.get(code)?.shares ?? 0;
      const signal = projectCashSignal(
        engineData,
        code,
        targetShares - currentShares,
        adjustmentFactor,
        refPrice,
        'target',
        targetWeight,
      );
      if (signal) {
        signals.push(signal);
      }
    }
  }

  if (pendingOrders) {
    for (const [code, delta] of pendingOrders) {
      const adjustmentFactor = engineData.adjAsOf(code, tradeDate);
      const refPrice = engineData.rawCloseAsOf(code, tradeDate);
      if (!adjustmentFactor || !refPrice) {
        continue;
      }

      const currentShares = portfolio.positions.get(code)?.shares ?? 0;
      const executableDelta = delta < 0 ? -Math.min(-delta, currentShares) : delta;
      const signal = projectCashSignal(
        engineData,
        code,
        executableDelta,
        adjustmentFactor,
        refPrice,
        'order',
      );
      if (signal) {
        signals.push(signal);
      }
    }
  }

  if (pendingLotOrders) {
    for (const [code, lots] of pendingLotOrders) {
      const adjustmentFactor = engineData.adjAsOf(code, tradeDate);
      const refPrice = engineData.rawCloseAsOf(code, tradeDate);
      if (!adjustmentFactor || !refPrice) {
        continue;
      }
      const signal = projectCashSignal(
        engineData,
        code,
        (lots * 100) / adjustmentFactor,
        adjustmentFactor,
        refPrice,
        'order',
      );
      if (signal) {
        signals.push(signal);
      }
    }
  }

  for (const order of conditionalOrders.values()) {
    const adjustmentFactor = engineData.adjAsOf(order.code, tradeDate);
    const refPrice = engineData.rawCloseAsOf(order.code, tradeDate);
    if (!adjustmentFactor || !refPrice) {
      continue;
    }
    const position = portfolio.positions.get(order.code);
    const action = order.kind === 'limit_buy' ? 'buy' : 'sell';
    const adjustedTrigger =
      order.kind === 'trailing_stop'
        ? order.highWater * (1 - order.trailingPct)
        : order.triggerPrice;
    const triggerPrice = adjustedTrigger / adjustmentFactor;
    let projectedShares = position?.shares ?? 0;
    if (pendingTargets?.has(order.code)) {
      const adjustedClose = engineData.closeAt(order.code, tradeDate);
      if (adjustedClose != null && adjustedClose > 0) {
        projectedShares = (pendingTargets.get(order.code)! * modelEquity) / adjustedClose;
      }
    }
    projectedShares = Math.max(
      0,
      projectedShares +
        (pendingOrders?.get(order.code) ?? 0) +
        ((pendingLotOrders?.get(order.code) ?? 0) * 100) / adjustmentFactor,
    );
    const realShares =
      action === 'buy'
        ? Math.floor((order.kind === 'limit_buy' ? order.shares * adjustmentFactor : 0) / 100) * 100
        : Math.max(0, Math.round(projectedShares * adjustmentFactor));
    if (realShares <= 0) {
      continue;
    }
    signals.push({
      code: order.code,
      assetType: engineData.assetType(order.code),
      action,
      shares: realShares,
      refPrice,
      refAmount: realShares * triggerPrice,
      source: 'conditional',
      orderType: order.kind,
      triggerPrice,
      ...(order.kind === 'trailing_stop' ? { trailingPct: order.trailingPct } : {}),
    });
  }

  return {
    tradeDate,
    modelEquity,
    modelCash: portfolio.cash,
    modelPositions,
    signals,
    factorObservations: [...factorObservations].flatMap(([key, byCode]) =>
      [...byCode].map(([code, value]) => ({ key, code, value })),
    ),
  };
}

function projectCashSignal(
  engineData: EngineData,
  code: string,
  adjustedDelta: number,
  adjustmentFactor: number,
  refPrice: number,
  source: PendingCashSignal['source'],
  targetWeight?: number,
): PendingCashSignal | null {
  const realDelta = adjustedDelta * adjustmentFactor;
  const shares =
    realDelta > 0
      ? Math.floor(realDelta / 100) * 100
      : Math.max(0, Math.round(Math.abs(realDelta)));
  if (shares === 0) {
    return null;
  }

  return {
    code,
    assetType: engineData.assetType(code),
    action: realDelta > 0 ? 'buy' : 'sell',
    shares,
    refPrice,
    refAmount: shares * refPrice,
    source,
    ...(targetWeight == null ? {} : { targetWeight }),
  };
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
    const currentPosition = futurePortfolio.position(code);
    const current = currentPosition?.contracts ?? 0;
    let target = intent.kind === 'delta' ? current + intent.value : intent.value;
    if (intent.kind === 'notional' || intent.kind === 'hedge') {
      const desiredNotional =
        intent.kind === 'hedge' ? -intent.value * stockExposure : intent.value;
      target = futureContractsForNotional(engineData, code, desiredNotional, date, mappingDate);
    }
    target = Math.trunc(target);
    const desiredActualCode = engineData.futureExecutionCode(code, mappingDate, date);
    if (currentPosition && desiredActualCode && desiredActualCode !== currentPosition.actualCode) {
      const closed = futurePortfolio.order(engineData, code, -current, date, mappingDate);
      if (!closed || target === 0) {
        continue;
      }
      futurePortfolio.order(engineData, code, target, date, mappingDate);
      continue;
    }
    const delta = target - current;
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
  validateTargetBook(targets);
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

  // Sells first (free up cash). Suspended and newly bought T+1 layers remain held.
  for (const [code, pos] of [...portfolio.positions]) {
    const px = openOf(code);
    if (px == null) {
      continue;
    }
    const tgt = targetShares.get(code) ?? 0;
    if (tgt < pos.shares && !limitBlocked(engineData, code, date, 'sell', px)) {
      const sell = Math.min(pos.shares - tgt, portfolio.sellableShares(code, date));
      if (sell <= 0) {
        continue;
      }
      const fillPx = execPrice(engineData, code, date, 'sell', px, sell * px, cost);
      portfolio.fill(
        code,
        -sell,
        fillPx,
        date,
        sellableFromFor(engineData, code, date),
        engineData.adjAt(code, date)!,
        engineData.assetType(code),
        px,
      );
    }
  }

  // Buys.
  for (const [code, tgt] of targetShares) {
    const px = openOf(code)!;
    const cur = portfolio.positions.get(code)?.shares ?? 0;
    if (tgt > cur && !limitBlocked(engineData, code, date, 'buy', px)) {
      const delta = tgt - cur;
      const fillPx = execPrice(engineData, code, date, 'buy', px, delta * px, cost);
      const adjustmentFactor = engineData.adjAt(code, date)!;
      const buy = Math.min(
        delta,
        portfolio.affordableShares(fillPx, engineData.assetType(code), adjustmentFactor),
      );
      portfolio.fill(
        code,
        buy,
        fillPx,
        date,
        sellableFromFor(engineData, code, date),
        adjustmentFactor,
        engineData.assetType(code),
        px,
      );
    }
  }
}

/**
 * Execute imperative share orders at `date`'s open. Sells run first (free up cash); a sell is
 * clamped to the T+1-sellable shares actually held, a buy to what cash can afford. Suspended codes
 * (no open) are skipped — the strategy can re-queue next bar.
 */
function mergeShareAndLotOrders(
  engineData: EngineData,
  date: string,
  shareOrders: Map<string, number> | null,
  lotOrders: Map<string, number> | null,
): Map<string, number> {
  const merged = new Map(shareOrders ?? []);
  for (const [code, lots] of lotOrders ?? []) {
    const adjustmentFactor = engineData.adjAt(code, date);
    if (adjustmentFactor == null || adjustmentFactor <= 0) {
      continue;
    }
    const adjustedShares = (lots * 100) / adjustmentFactor;
    merged.set(code, (merged.get(code) ?? 0) + adjustedShares);
  }
  return merged;
}

function executeOrders(
  portfolio: Portfolio,
  engineData: EngineData,
  date: string,
  orders: Map<string, number>,
  cost: CostModel,
): void {
  for (const [code, delta] of orders) {
    if (delta >= 0) {
      continue;
    }
    const px = engineData.openAt(code, date);
    const pos = portfolio.positions.get(code);
    if (px == null || !pos) {
      continue;
    } // suspended or no position
    const sell = Math.min(-delta, portfolio.sellableShares(code, date));
    if (sell > 0 && !limitBlocked(engineData, code, date, 'sell', px)) {
      const fillPx = execPrice(engineData, code, date, 'sell', px, sell * px, cost);
      portfolio.fill(
        code,
        -sell,
        fillPx,
        date,
        sellableFromFor(engineData, code, date),
        engineData.adjAt(code, date)!,
        engineData.assetType(code),
        px,
      );
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
    const assetType = engineData.assetType(code);
    const adjustmentFactor = engineData.adjAt(code, date)!;
    const buy = Math.min(delta, portfolio.affordableShares(fillPx, assetType, adjustmentFactor));
    if (buy > 0) {
      portfolio.fill(
        code,
        buy,
        fillPx,
        date,
        sellableFromFor(engineData, code, date),
        adjustmentFactor,
        assetType,
        px,
      );
    }
  }
}

function sellableFromFor(engineData: EngineData, code: string, date: string): string {
  return engineData.supportsSameDayTurnover(code) ? date : engineData.nextDay(date);
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
  cost: CostModel,
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

  // —— Total-return benchmark comparison: excess return + annualized information ratio ——
  const benchByDate = new Map(bench.map((b) => [b.date, b.close]));
  const missingBenchmarkDate = nav.find((point) => !benchByDate.has(point.date))?.date;
  if (missingBenchmarkDate) {
    throw new Error(
      `Benchmark ${BENCHMARK} has no close for ${missingBenchmarkDate}; performance comparison cannot be computed`,
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

function stockTradePnl(tradeLog: BacktestResult['tradeLog']): number[] {
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
