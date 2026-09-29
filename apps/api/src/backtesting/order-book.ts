import { EngineData } from './data/engine-data.js';
import { CashPortfolio } from './cash-portfolio.js';
import { FuturesPortfolio } from './futures-portfolio.js';
import type { CostModel } from './cost.js';
import type { AllocationAnalysisTracker } from './allocation-analysis.js';
export type ConditionalOrderKind = 'stop_loss' | 'trailing_stop' | 'limit_buy' | 'take_profit';
export type ConditionalOrder =
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

type FutureIntent =
  | { kind: 'delta'; value: number }
  | { kind: 'contracts'; value: number }
  | { kind: 'notional'; value: number }
  | { kind: 'hedge'; value: number };

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

interface OrderDecision {
  targets: Map<string, number> | null;
  orders: Map<string, number> | null;
  lotOrders: Map<string, number> | null;
  conditionalCommands: ConditionalCommand[];
  futureIntents: Map<string, FutureIntent> | null;
}

export interface CashOrderSnapshot {
  pendingTargets: Map<string, number> | null;
  pendingOrders: Map<string, number> | null;
  pendingLotOrders: Map<string, number> | null;
  conditionalOrders: Map<string, ConditionalOrder>;
}
interface OrderBookInput {
  engineData: EngineData;
  cashPortfolio: CashPortfolio;
  futuresPortfolio: FuturesPortfolio | null;
  cost: CostModel;
  stockOrdersEnabled: boolean;
}

/** Owns decision collection, next-open orders and persistent conditional orders. */
export class OrderBook {
  private date = '';
  private decision: OrderDecision = this.emptyDecision();
  private pendingTargets: Map<string, number> | null = null;
  private pendingTargetDecisionDate: string | null = null;
  private pendingOrders: Map<string, number> | null = null;
  private pendingLotOrders: Map<string, number> | null = null;
  private pendingFutureIntents: Map<string, FutureIntent> | null = null;
  private readonly conditionalOrders = new Map<string, ConditionalOrder>();

  constructor(private readonly input: OrderBookInput) {}

  private emptyDecision(): OrderDecision {
    return {
      targets: null,
      orders: null,
      lotOrders: null,
      conditionalCommands: [],
      futureIntents: null,
    };
  }

  beginDecision(date: string): void {
    this.date = date;
    this.decision = this.emptyDecision();
  }

  commitDecision(): void {
    validateTargetBook(this.decision.targets);
    this.pendingTargets = this.decision.targets;
    this.pendingTargetDecisionDate = this.decision.targets ? this.date : null;
    this.pendingOrders = this.decision.orders;
    this.pendingLotOrders = this.decision.lotOrders;
    this.pendingFutureIntents = this.decision.futureIntents;
    this.applyConditionalCommands();
  }

  snapshot(): CashOrderSnapshot {
    return structuredClone({
      pendingTargets: this.pendingTargets,
      pendingOrders: this.pendingOrders,
      pendingLotOrders: this.pendingLotOrders,
      conditionalOrders: this.conditionalOrders,
    });
  }

  /** Keep roll, cash fills, conditions and futures intents in their original execution order. */
  async executeOpen(
    date: string,
    previousDate: string | undefined,
    allocationTracker: AllocationAnalysisTracker | null,
    onRebalance: () => void,
  ): Promise<void> {
    const { engineData, cashPortfolio: portfolio, futuresPortfolio } = this.input;
    const heldBeforeOpen = new Set(portfolio.positions.keys());

    if (futuresPortfolio && previousDate) {
      futuresPortfolio.roll(
        engineData,
        date,
        previousDate,
        new Set(this.pendingFutureIntents?.keys() ?? []),
      );
    }

    if (this.pendingTargets) {
      await engineData.loadBars([
        ...new Set([...this.pendingTargets.keys(), ...portfolio.positions.keys()]),
      ]);
      const preTrade = allocationTracker?.weights(
        portfolio.cash,
        portfolio.positions,
        (code) => engineData.adjustedOpenOn(code, date) ?? engineData.adjustedCloseAsOf(code, date),
      );
      this.rebalance(date);
      if (allocationTracker && preTrade && this.pendingTargetDecisionDate) {
        allocationTracker.captureRebalance({
          decisionDate: this.pendingTargetDecisionDate,
          executionDate: date,
          targets: this.pendingTargets,
          preTrade,
          postTrade: allocationTracker.weights(
            portfolio.cash,
            portfolio.positions,
            (code) =>
              engineData.adjustedOpenOn(code, date) ?? engineData.adjustedCloseAsOf(code, date),
          ),
        });
      }
      this.pendingTargets = null;
      this.pendingTargetDecisionDate = null;
      onRebalance();
    }

    if (this.pendingOrders || this.pendingLotOrders) {
      await engineData.loadBars([
        ...new Set([
          ...(this.pendingOrders?.keys() ?? []),
          ...(this.pendingLotOrders?.keys() ?? []),
        ]),
      ]);
      this.executeOrders(date);
      this.pendingOrders = null;
      this.pendingLotOrders = null;
    }

    this.removeConditionsForClosedPositions(heldBeforeOpen);
    if (this.conditionalOrders.size > 0) {
      await engineData.loadBars([
        ...new Set([...this.conditionalOrders.values()].map((order) => order.code)),
      ]);
      this.executeConditionalOrders(date);
    }

    if (futuresPortfolio && previousDate && this.pendingFutureIntents) {
      this.executeFutureIntents(date, previousDate);
      this.pendingFutureIntents = null;
    }
  }

  orderTargetPercent(code: string, weight: number): void {
    assertStockOrdersEnabled(this.input.stockOrdersEnabled);
    validateTargetWeight(code, weight);
    this.decision.targets ??= new Map();
    this.decision.targets.set(code, weight);
  }

  setHoldings(weights: Record<string, number> | Map<string, number>): void {
    assertStockOrdersEnabled(this.input.stockOrdersEnabled);
    const targetWeights = new Map(weights instanceof Map ? weights : Object.entries(weights));
    validateTargetBook(targetWeights);
    this.decision.targets = targetWeights;
  }

  order(code: string, shares: number): void {
    assertStockOrdersEnabled(this.input.stockOrdersEnabled);
    assertFiniteOrderValue(shares, 'Order shares');
    if (!shares) {
      return;
    }
    this.decision.orders ??= new Map();
    this.decision.orders.set(code, (this.decision.orders.get(code) ?? 0) + shares);
  }

  orderLots(code: string, lots: number): void {
    assertStockOrdersEnabled(this.input.stockOrdersEnabled);
    assertFiniteOrderValue(lots, 'Order lots');
    const wholeLots = Math.trunc(lots);
    if (!wholeLots) {
      return;
    }
    this.decision.lotOrders ??= new Map();
    this.decision.lotOrders.set(code, (this.decision.lotOrders.get(code) ?? 0) + wholeLots);
  }

  exit(code: string): void {
    assertStockOrdersEnabled(this.input.stockOrdersEnabled);
    const held = this.input.cashPortfolio.positions.get(code)?.shares ?? 0;
    if (!held) {
      return;
    }
    this.decision.orders ??= new Map();
    this.decision.orders.set(code, (this.decision.orders.get(code) ?? 0) - held);
  }

  stopLoss(code: string, price: number): void {
    assertStockOrdersEnabled(this.input.stockOrdersEnabled);
    assertPositiveOrderValue(price, 'Stop-loss price');
    this.decision.conditionalCommands.push({
      action: 'upsert',
      order: { kind: 'stop_loss', code, triggerPrice: price },
    });
  }

  trailingStop(code: string, pct: number): void {
    assertStockOrdersEnabled(this.input.stockOrdersEnabled);
    assertFraction(pct, 'Trailing-stop percentage');
    const highWater = this.input.engineData.adjustedCloseAsOf(code, this.date);
    if (highWater == null || highWater <= 0) {
      return;
    }
    this.decision.conditionalCommands.push({
      action: 'upsert',
      order: { kind: 'trailing_stop', code, trailingPct: pct, highWater },
    });
  }

  limitBuy(code: string, price: number, shares: number): void {
    assertStockOrdersEnabled(this.input.stockOrdersEnabled);
    assertPositiveOrderValue(price, 'Limit-buy price');
    assertPositiveOrderValue(shares, 'Limit-buy shares');
    this.decision.conditionalCommands.push({
      action: 'upsert',
      order: { kind: 'limit_buy', code, triggerPrice: price, shares },
    });
  }

  takeProfit(code: string, pct: number): void {
    assertStockOrdersEnabled(this.input.stockOrdersEnabled);
    assertPositiveOrderValue(pct, 'Take-profit percentage');
    const position = this.input.cashPortfolio.positions.get(code);
    if (!position) {
      return;
    }
    this.decision.conditionalCommands.push({
      action: 'upsert',
      order: {
        kind: 'take_profit',
        code,
        triggerPrice: position.avgCost * (1 + pct),
      },
    });
  }

  cancelConditional(code: string, kind?: ConditionalOrderKind): void {
    assertStockOrdersEnabled(this.input.stockOrdersEnabled);
    this.decision.conditionalCommands.push({ action: 'cancel', code, kind });
  }

  orderFuture(code: string, contracts: number): void {
    if (!this.input.futuresPortfolio) {
      throw new Error('Declare strategy.futures to use futures orders');
    }

    assertFiniteOrderValue(contracts, 'Futures contracts');
    const roundedContracts = Math.trunc(contracts);
    if (!roundedContracts) {
      return;
    }
    this.decision.futureIntents ??= new Map();
    const prior = this.decision.futureIntents.get(code);
    const value = prior?.kind === 'delta' ? prior.value + roundedContracts : roundedContracts;
    this.decision.futureIntents.set(code, { kind: 'delta', value });
  }

  setFutureTargetContracts(code: string, contracts: number): void {
    if (!this.input.futuresPortfolio) {
      throw new Error('Declare strategy.futures to use futures orders');
    }

    assertFiniteOrderValue(contracts, 'Futures target contracts');
    this.decision.futureIntents ??= new Map();
    this.decision.futureIntents.set(code, { kind: 'contracts', value: Math.trunc(contracts) });
  }

  setFutureTargetNotional(code: string, notional: number): void {
    if (!this.input.futuresPortfolio) {
      throw new Error('Declare strategy.futures to use futures orders');
    }

    assertFiniteOrderValue(notional, 'Futures target notional');
    this.decision.futureIntents ??= new Map();
    this.decision.futureIntents.set(code, { kind: 'notional', value: notional });
  }

  hedgeFuture(code: string, beta = 1): void {
    if (!this.input.futuresPortfolio) {
      throw new Error('Declare strategy.futures to use futures orders');
    }

    if (!Number.isFinite(beta) || beta < 0) {
      throw new Error('Futures hedge beta must be a finite non-negative number');
    }
    this.decision.futureIntents ??= new Map();
    this.decision.futureIntents.set(code, { kind: 'hedge', value: beta });
  }

  exitFuture(code: string): void {
    if (!this.input.futuresPortfolio) {
      throw new Error('Declare strategy.futures to use futures orders');
    }

    this.decision.futureIntents ??= new Map();
    this.decision.futureIntents.set(code, { kind: 'contracts', value: 0 });
  }

  private rebalance(date: string): void {
    const { cashPortfolio: portfolio, engineData, cost } = this.input;
    const targets = this.pendingTargets;
    if (!targets) {
      return;
    }

    validateTargetBook(targets);
    const openOf = (code: string) => engineData.adjustedOpenOn(code, date);

    // Equity valued at today's open, consistent with fill prices.
    const equity = portfolio.equity(
      (code) => openOf(code) ?? engineData.adjustedCloseAsOf(code, date),
    );

    const targetShares = new Map<string, number>();
    for (const [code, weight] of targets) {
      const price = openOf(code);
      if (price && price > 0) {
        targetShares.set(code, (weight * equity) / price);
      }
    }

    // Sells first (free up cash). Suspended and newly bought T+1 layers remain held.
    for (const [code, position] of [...portfolio.positions]) {
      const price = openOf(code);
      if (price == null) {
        continue;
      }
      const target = targetShares.get(code) ?? 0;
      if (target < position.shares && !limitBlocked(engineData, code, date, 'sell', price)) {
        const sell = Math.min(position.shares - target, portfolio.sellableShares(code, date));
        if (sell <= 0) {
          continue;
        }
        const fillPrice = executionPrice(engineData, code, date, 'sell', price, sell * price, cost);
        portfolio.fill({
          code,
          adjustedShareDelta: -sell,
          adjustedPrice: fillPrice,
          date,
          sellableFrom: sellableFromFor(engineData, code, date),
          adjustmentFactor: engineData.adjustmentFactorOn(code, date)!,
          assetType: engineData.assetType(code),
          referenceAdjustedPrice: price,
        });
      }
    }

    // Buys.
    for (const [code, target] of targetShares) {
      const price = openOf(code)!;
      const currentShares = portfolio.positions.get(code)?.shares ?? 0;
      if (target > currentShares && !limitBlocked(engineData, code, date, 'buy', price)) {
        const delta = target - currentShares;
        const fillPrice = executionPrice(engineData, code, date, 'buy', price, delta * price, cost);
        const adjustmentFactor = engineData.adjustmentFactorOn(code, date)!;
        const buy = Math.min(
          delta,
          portfolio.affordableShares(fillPrice, engineData.assetType(code), adjustmentFactor),
        );
        portfolio.fill({
          code,
          adjustedShareDelta: buy,
          adjustedPrice: fillPrice,
          date,
          sellableFrom: sellableFromFor(engineData, code, date),
          adjustmentFactor,
          assetType: engineData.assetType(code),
          referenceAdjustedPrice: price,
        });
      }
    }
  }

  private executeOrders(date: string): void {
    const { cashPortfolio: portfolio, engineData, cost } = this.input;
    const orders = mergeShareAndLotOrders(
      engineData,
      date,
      this.pendingOrders,
      this.pendingLotOrders,
    );

    for (const [code, delta] of orders) {
      if (delta >= 0) {
        continue;
      }
      const price = engineData.adjustedOpenOn(code, date);
      const position = portfolio.positions.get(code);
      if (price == null || !position) {
        continue;
      } // suspended or no position
      const sell = Math.min(-delta, portfolio.sellableShares(code, date));
      if (sell > 0 && !limitBlocked(engineData, code, date, 'sell', price)) {
        const fillPrice = executionPrice(engineData, code, date, 'sell', price, sell * price, cost);
        portfolio.fill({
          code,
          adjustedShareDelta: -sell,
          adjustedPrice: fillPrice,
          date,
          sellableFrom: sellableFromFor(engineData, code, date),
          adjustmentFactor: engineData.adjustmentFactorOn(code, date)!,
          assetType: engineData.assetType(code),
          referenceAdjustedPrice: price,
        });
      }
    }

    for (const [code, delta] of orders) {
      if (delta <= 0) {
        continue;
      }
      const price = engineData.adjustedOpenOn(code, date);
      if (price == null || price <= 0) {
        continue;
      } // suspended
      if (limitBlocked(engineData, code, date, 'buy', price)) {
        continue;
      } // up-limit sealed — can't buy
      // Slippage lifts the buy price → size affordability on the slipped price so we don't overspend.
      const fillPrice = executionPrice(engineData, code, date, 'buy', price, delta * price, cost);
      const assetType = engineData.assetType(code);
      const adjustmentFactor = engineData.adjustmentFactorOn(code, date)!;
      const buy = Math.min(
        delta,
        portfolio.affordableShares(fillPrice, assetType, adjustmentFactor),
      );
      if (buy > 0) {
        portfolio.fill({
          code,
          adjustedShareDelta: buy,
          adjustedPrice: fillPrice,
          date,
          sellableFrom: sellableFromFor(engineData, code, date),
          adjustmentFactor,
          assetType,
          referenceAdjustedPrice: price,
        });
      }
    }
  }

  private executeConditionalOrders(date: string): void {
    const { cashPortfolio: portfolio, engineData, cost } = this.input;
    const book = this.conditionalOrders;

    const byCode = new Map<string, ConditionalOrder[]>();
    for (const order of book.values()) {
      const orders = byCode.get(order.code) ?? [];
      orders.push(order);
      byCode.set(order.code, orders);
    }

    for (const [code, orders] of byCode) {
      const bar = engineData.adjustedOhlcOn(code, date);
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
        const slippedPrice = executionPrice(
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
        portfolio.fill({
          code,
          adjustedShareDelta: -sellableShares,
          adjustedPrice: fillPrice,
          date,
          sellableFrom: sellableFromFor(engineData, code, date),
          adjustmentFactor: engineData.adjustmentFactorOn(code, date)!,
          assetType: engineData.assetType(code),
          referenceAdjustedPrice: basePrice,
        });
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
        const slippedPrice = executionPrice(
          engineData,
          code,
          date,
          'buy',
          basePrice,
          order.shares * basePrice,
          cost,
        );
        const fillPrice = Math.min(order.triggerPrice, slippedPrice);
        const adjustmentFactor = engineData.adjustmentFactorOn(code, date)!;
        const buy = Math.min(
          order.shares,
          portfolio.affordableShares(fillPrice, engineData.assetType(code), adjustmentFactor),
        );
        if (buy <= 0) {
          continue;
        }
        portfolio.fill({
          code,
          adjustedShareDelta: buy,
          adjustedPrice: fillPrice,
          date,
          sellableFrom: sellableFromFor(engineData, code, date),
          adjustmentFactor,
          assetType: engineData.assetType(code),
          referenceAdjustedPrice: basePrice,
        });
        book.delete(conditionalOrderKey(order.kind, code));
      }

      for (const order of orders) {
        if (order.kind === 'trailing_stop' && book.has(conditionalOrderKey(order.kind, code))) {
          order.highWater = Math.max(order.highWater, bar.high);
        }
      }
    }
  }

  private executeFutureIntents(date: string, mappingDate: string): void {
    const {
      futuresPortfolio: futurePortfolio,
      cashPortfolio: stockPortfolio,
      engineData,
    } = this.input;
    const intents = this.pendingFutureIntents;
    if (!futurePortfolio || !intents) {
      return;
    }

    const stockExposure = stockPortfolio.marketValue(
      (code) => engineData.adjustedOpenOn(code, date) ?? engineData.adjustedCloseAsOf(code, date),
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
      if (
        currentPosition &&
        desiredActualCode &&
        desiredActualCode !== currentPosition.actualCode
      ) {
        const closed = futurePortfolio.executeOrder({
          engineData,
          code,
          contractDelta: -current,
          executionDate: date,
          decisionDate: mappingDate,
        });
        if (!closed || target === 0) {
          continue;
        }
        futurePortfolio.executeOrder({
          engineData,
          code,
          contractDelta: target,
          executionDate: date,
          decisionDate: mappingDate,
        });
        continue;
      }
      const delta = target - current;
      if (delta !== 0) {
        futurePortfolio.executeOrder({
          engineData,
          code,
          contractDelta: delta,
          executionDate: date,
          decisionDate: mappingDate,
        });
      }
    }
  }

  private removeConditionsForClosedPositions(heldBeforeOpen: Set<string>): void {
    const portfolio = this.input.cashPortfolio;
    const book = this.conditionalOrders;

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

  private applyConditionalCommands(): void {
    const book = this.conditionalOrders;
    const commands = this.decision.conditionalCommands;
    const placedDate = this.date;

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
}

const MAX_SLIPPAGE = 0.1;

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

function conditionalLimitBlocked(
  engineData: EngineData,
  code: string,
  date: string,
  side: 'buy' | 'sell',
  bar: { high: number; low: number },
): boolean {
  const limit = engineData.priceLimitsOn(code, date);
  const adjustmentFactor = engineData.adjustmentFactorOn(code, date);
  if (!limit || !adjustmentFactor || adjustmentFactor <= 0) {
    return false;
  }
  const epsilon = 1e-3;
  return side === 'buy'
    ? limit.up != null && bar.low / adjustmentFactor >= limit.up - epsilon
    : limit.down != null && bar.high / adjustmentFactor <= limit.down + epsilon;
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

function mergeShareAndLotOrders(
  engineData: EngineData,
  date: string,
  shareOrders: Map<string, number> | null,
  lotOrders: Map<string, number> | null,
): Map<string, number> {
  const merged = new Map(shareOrders ?? []);
  for (const [code, lots] of lotOrders ?? []) {
    const adjustmentFactor = engineData.adjustmentFactorOn(code, date);
    if (adjustmentFactor == null || adjustmentFactor <= 0) {
      continue;
    }
    const adjustedShares = (lots * 100) / adjustmentFactor;
    merged.set(code, (merged.get(code) ?? 0) + adjustedShares);
  }
  return merged;
}

function sellableFromFor(engineData: EngineData, code: string, date: string): string {
  return engineData.supportsSameDayTurnover(code) ? date : engineData.nextDay(date);
}

export function executionPrice(
  engineData: EngineData,
  code: string,
  date: string,
  side: 'buy' | 'sell',
  adjustedPrice: number,
  notionalYuan: number,
  cost: CostModel,
): number {
  const base = cost.slippageBps / 1e4;
  const dayTurnoverYuan = (engineData.turnoverOn(code, date) ?? 0) * 1000; // amount is in thousand yuan
  const impact = dayTurnoverYuan > 0 ? cost.impactCoef * (notionalYuan / dayTurnoverYuan) : 0;
  const slip = Math.min(base + impact, MAX_SLIPPAGE);
  return side === 'buy' ? adjustedPrice * (1 + slip) : adjustedPrice * (1 - slip);
}

function limitBlocked(
  engineData: EngineData,
  code: string,
  date: string,
  side: 'buy' | 'sell',
  adjustedPrice: number,
): boolean {
  const limits = engineData.priceLimitsOn(code, date);
  if (!limits) {
    return false;
  }
  const adjustmentFactor = engineData.adjustmentFactorOn(code, date);
  if (adjustmentFactor == null || adjustmentFactor <= 0) {
    return false;
  }
  const rawOpen = adjustedPrice / adjustmentFactor;
  const epsilon = 1e-3;
  return side === 'buy'
    ? limits.up != null && rawOpen >= limits.up - epsilon
    : limits.down != null && rawOpen <= limits.down + epsilon;
}
