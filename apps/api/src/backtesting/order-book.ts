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
  shareOrders: Map<string, number> | null;
  lotOrders: Map<string, number> | null;
  conditionalCommands: ConditionalCommand[];
  futureIntents: Map<string, FutureIntent> | null;
}

interface PendingOrders {
  decisionDate: string | null;
  targets: Map<string, number> | null;
  shareOrders: Map<string, number> | null;
  lotOrders: Map<string, number> | null;
  futureIntents: Map<string, FutureIntent> | null;
}

function emptyDecision(): OrderDecision {
  return {
    targets: null,
    shareOrders: null,
    lotOrders: null,
    conditionalCommands: [],
    futureIntents: null,
  };
}

function emptyPendingOrders(): PendingOrders {
  return {
    decisionDate: null,
    targets: null,
    shareOrders: null,
    lotOrders: null,
    futureIntents: null,
  };
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
  futuresPortfolio: FuturesPortfolio;
  cost: CostModel;
  allocationTracker: AllocationAnalysisTracker;
  onRebalance: (date: string) => void;
}

/** Owns decision collection, pending execution and persistent conditional orders. */
export class OrderBook {
  private decisionDate = '';
  private decision = emptyDecision();
  private readonly pending = emptyPendingOrders();
  private readonly conditionalOrders = new Map<string, ConditionalOrder>();

  constructor(private readonly input: OrderBookInput) {}

  get hasFutureIntents(): boolean {
    return Boolean(this.decision.futureIntents?.size);
  }

  beginDecision(date: string): void {
    this.decisionDate = date;
    this.decision = emptyDecision();
  }

  commitDecision(): void {
    validateTargetBook(this.decision.targets);
    this.pending.targets = this.decision.targets;
    this.pending.decisionDate = this.decision.targets ? this.decisionDate : null;
    this.pending.shareOrders = this.decision.shareOrders;
    this.pending.lotOrders = this.decision.lotOrders;
    this.pending.futureIntents = this.decision.futureIntents;

    this.applyConditionalCommands();
  }

  /** Returns a detached snapshot of cash orders only. */
  snapshot(): CashOrderSnapshot {
    return structuredClone({
      pendingTargets: this.pending.targets,
      pendingOrders: this.pending.shareOrders,
      pendingLotOrders: this.pending.lotOrders,
      conditionalOrders: this.conditionalOrders,
    });
  }

  /** Executes pending orders and intraday conditional simulations before daily settlement. */
  async executeOrders(date: string, previousDate: string | undefined): Promise<void> {
    const { engineData, cashPortfolio, futuresPortfolio } = this.input;
    const heldBeforeExecution = new Set(cashPortfolio.positions.keys());

    if (previousDate) {
      futuresPortfolio.roll(
        engineData,
        date,
        previousDate,
        new Set(this.pending.futureIntents?.keys() ?? []),
      );
    }

    await this.executePendingRebalance(date);

    await this.executePendingCashOrders(date);

    this.removeConditionsForClosedPositions(heldBeforeExecution);

    await this.executeActiveConditionalOrders(date);

    if (previousDate) {
      this.executePendingFutureIntents(date, previousDate);
    }
  }

  private async executePendingRebalance(date: string): Promise<void> {
    const { engineData, cashPortfolio, allocationTracker, onRebalance } = this.input;
    const { targets, decisionDate } = this.pending;
    if (!targets) {
      return;
    }

    await engineData.loadBars([...new Set([...targets.keys(), ...cashPortfolio.positions.keys()])]);

    const preTrade = allocationTracker.weights(
      cashPortfolio.cash,
      cashPortfolio.positions,
      (code) => engineData.adjustedOpenOn(code, date) ?? engineData.adjustedCloseAsOf(code, date),
    );

    this.rebalance(date);

    if (decisionDate) {
      allocationTracker.captureRebalance({
        decisionDate,
        executionDate: date,
        targets,
        preTrade,
        postTrade: allocationTracker.weights(
          cashPortfolio.cash,
          cashPortfolio.positions,
          (code) =>
            engineData.adjustedOpenOn(code, date) ?? engineData.adjustedCloseAsOf(code, date),
        ),
      });
    }

    this.pending.targets = null;
    this.pending.decisionDate = null;
    onRebalance(date);
  }

  private async executePendingCashOrders(date: string): Promise<void> {
    const { shareOrders, lotOrders } = this.pending;
    if (!shareOrders && !lotOrders) {
      return;
    }

    await this.input.engineData.loadBars([
      ...new Set([...(shareOrders?.keys() ?? []), ...(lotOrders?.keys() ?? [])]),
    ]);

    this.executeCashOrders(date);

    this.pending.shareOrders = null;
    this.pending.lotOrders = null;
  }

  private async executeActiveConditionalOrders(date: string): Promise<void> {
    if (this.conditionalOrders.size === 0) {
      return;
    }

    await this.input.engineData.loadBars([
      ...new Set([...this.conditionalOrders.values()].map((order) => order.code)),
    ]);

    this.executeConditionalOrders(date);
  }

  orderTargetPercent(code: string, weight: number): void {
    validateTargetWeight(code, weight);
    this.decision.targets ??= new Map();
    this.decision.targets.set(code, weight);
  }

  setHoldings(weights: Record<string, number> | Map<string, number>): void {
    const targetWeights = new Map(weights instanceof Map ? weights : Object.entries(weights));
    validateTargetBook(targetWeights);
    this.decision.targets = targetWeights;
  }

  order(code: string, shares: number): void {
    assertFiniteOrderValue(shares, 'Order shares');
    if (!shares) {
      return;
    }
    this.decision.shareOrders ??= new Map();
    this.decision.shareOrders.set(code, (this.decision.shareOrders.get(code) ?? 0) + shares);
  }

  orderLots(code: string, lots: number): void {
    assertFiniteOrderValue(lots, 'Order lots');
    const wholeLots = Math.trunc(lots);
    if (!wholeLots) {
      return;
    }
    this.decision.lotOrders ??= new Map();
    this.decision.lotOrders.set(code, (this.decision.lotOrders.get(code) ?? 0) + wholeLots);
  }

  exit(code: string): void {
    const held = this.input.cashPortfolio.positions.get(code)?.shares ?? 0;
    if (!held) {
      return;
    }
    this.decision.shareOrders ??= new Map();
    this.decision.shareOrders.set(code, (this.decision.shareOrders.get(code) ?? 0) - held);
  }

  stopLoss(code: string, price: number): void {
    assertPositiveOrderValue(price, 'Stop-loss price');
    this.decision.conditionalCommands.push({
      action: 'upsert',
      order: { kind: 'stop_loss', code, triggerPrice: price },
    });
  }

  trailingStop(code: string, pct: number): void {
    assertFraction(pct, 'Trailing-stop percentage');
    const highWater = this.input.engineData.adjustedCloseAsOf(code, this.decisionDate);
    if (highWater == null || highWater <= 0) {
      return;
    }
    this.decision.conditionalCommands.push({
      action: 'upsert',
      order: { kind: 'trailing_stop', code, trailingPct: pct, highWater },
    });
  }

  limitBuy(code: string, price: number, shares: number): void {
    assertPositiveOrderValue(price, 'Limit-buy price');
    assertPositiveOrderValue(shares, 'Limit-buy shares');
    this.decision.conditionalCommands.push({
      action: 'upsert',
      order: { kind: 'limit_buy', code, triggerPrice: price, shares },
    });
  }

  takeProfit(code: string, pct: number): void {
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
    this.decision.conditionalCommands.push({ action: 'cancel', code, kind });
  }

  orderFuture(code: string, contracts: number): void {
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
    assertFiniteOrderValue(contracts, 'Futures target contracts');
    this.decision.futureIntents ??= new Map();
    this.decision.futureIntents.set(code, { kind: 'contracts', value: Math.trunc(contracts) });
  }

  setFutureTargetNotional(code: string, notional: number): void {
    assertFiniteOrderValue(notional, 'Futures target notional');
    this.decision.futureIntents ??= new Map();
    this.decision.futureIntents.set(code, { kind: 'notional', value: notional });
  }

  hedgeFuture(code: string, beta = 1): void {
    if (!Number.isFinite(beta) || beta < 0) {
      throw new Error('Futures hedge beta must be a finite non-negative number');
    }
    this.decision.futureIntents ??= new Map();
    this.decision.futureIntents.set(code, { kind: 'hedge', value: beta });
  }

  exitFuture(code: string): void {
    this.decision.futureIntents ??= new Map();
    this.decision.futureIntents.set(code, { kind: 'contracts', value: 0 });
  }

  private rebalance(date: string): void {
    const { cashPortfolio, engineData, cost } = this.input;
    const targets = this.pending.targets;
    if (!targets) {
      return;
    }

    validateTargetBook(targets);
    const openOf = (code: string) => engineData.adjustedOpenOn(code, date);

    // Equity valued at today's open, consistent with fill prices.
    const equity = cashPortfolio.equity(
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
    for (const [code, position] of [...cashPortfolio.positions]) {
      const price = openOf(code);
      if (price == null) {
        continue;
      }
      const target = targetShares.get(code) ?? 0;
      if (target < position.shares && !limitBlocked(engineData, code, date, 'sell', price)) {
        const sell = Math.min(position.shares - target, cashPortfolio.sellableShares(code, date));
        if (sell <= 0) {
          continue;
        }
        const fillPrice = executionPrice(engineData, code, date, 'sell', price, sell * price, cost);
        cashPortfolio.fill({
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
      const currentShares = cashPortfolio.positions.get(code)?.shares ?? 0;
      if (target > currentShares && !limitBlocked(engineData, code, date, 'buy', price)) {
        const delta = target - currentShares;
        const fillPrice = executionPrice(engineData, code, date, 'buy', price, delta * price, cost);
        const adjustmentFactor = engineData.adjustmentFactorOn(code, date)!;
        const buy = Math.min(
          delta,
          cashPortfolio.affordableShares(fillPrice, engineData.assetType(code), adjustmentFactor),
        );
        cashPortfolio.fill({
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

  private executeCashOrders(date: string): void {
    const { cashPortfolio, engineData, cost } = this.input;
    const orders = mergeShareAndLotOrders(
      engineData,
      date,
      this.pending.shareOrders,
      this.pending.lotOrders,
    );

    for (const [code, delta] of orders) {
      if (delta >= 0) {
        continue;
      }
      const price = engineData.adjustedOpenOn(code, date);
      const position = cashPortfolio.positions.get(code);
      if (price == null || !position) {
        continue;
      } // suspended or no position
      const sell = Math.min(-delta, cashPortfolio.sellableShares(code, date));
      if (sell > 0 && !limitBlocked(engineData, code, date, 'sell', price)) {
        const fillPrice = executionPrice(engineData, code, date, 'sell', price, sell * price, cost);
        cashPortfolio.fill({
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
        cashPortfolio.affordableShares(fillPrice, assetType, adjustmentFactor),
      );
      if (buy > 0) {
        cashPortfolio.fill({
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
    const { cashPortfolio, engineData, cost } = this.input;
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

      const position = cashPortfolio.positions.get(code);
      const sellableShares = cashPortfolio.sellableShares(code, date);
      const exitCandidate = selectConditionalExit(orders, bar);

      if (
        sellableShares > 0 &&
        position &&
        exitCandidate &&
        !conditionalLimitBlocked(engineData, code, date, 'sell', bar)
      ) {
        const isProfit = exitCandidate.order.kind === 'take_profit';
        const basePrice = conditionalExitBasePrice(exitCandidate, bar.open);
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
        cashPortfolio.fill({
          code,
          adjustedShareDelta: -sellableShares,
          adjustedPrice: fillPrice,
          date,
          sellableFrom: sellableFromFor(engineData, code, date),
          adjustmentFactor: engineData.adjustmentFactorOn(code, date)!,
          assetType: engineData.assetType(code),
          referenceAdjustedPrice: basePrice,
        });
        if (!cashPortfolio.positions.has(code)) {
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
          cashPortfolio.affordableShares(fillPrice, engineData.assetType(code), adjustmentFactor),
        );
        if (buy <= 0) {
          continue;
        }
        cashPortfolio.fill({
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

  private executePendingFutureIntents(date: string, mappingDate: string): void {
    const { futuresPortfolio, cashPortfolio, engineData } = this.input;
    const intents = this.pending.futureIntents;
    if (!intents) {
      return;
    }

    const cashExposure = cashPortfolio.marketValue(
      (code) => engineData.adjustedOpenOn(code, date) ?? engineData.adjustedCloseAsOf(code, date),
    );

    for (const [code, intent] of intents) {
      const currentPosition = futuresPortfolio.position(code);
      const current = currentPosition?.contracts ?? 0;
      const target = this.resolveFutureTargetContracts(
        intent,
        code,
        current,
        cashExposure,
        date,
        mappingDate,
      );
      const desiredActualCode = engineData.futureExecutionCode(code, mappingDate, date);
      if (
        currentPosition &&
        desiredActualCode &&
        desiredActualCode !== currentPosition.actualCode
      ) {
        const closed = futuresPortfolio.executeOrder({
          engineData,
          code,
          contractDelta: -current,
          executionDate: date,
          decisionDate: mappingDate,
        });
        if (!closed || target === 0) {
          continue;
        }
        futuresPortfolio.executeOrder({
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
        futuresPortfolio.executeOrder({
          engineData,
          code,
          contractDelta: delta,
          executionDate: date,
          decisionDate: mappingDate,
        });
      }
    }

    this.pending.futureIntents = null;
  }

  private resolveFutureTargetContracts(
    intent: FutureIntent,
    code: string,
    current: number,
    cashExposure: number,
    date: string,
    mappingDate: string,
  ): number {
    switch (intent.kind) {
      case 'delta':
        return Math.trunc(current + intent.value);
      case 'contracts':
        return Math.trunc(intent.value);
      case 'notional':
        return Math.trunc(
          futureContractsForNotional(this.input.engineData, code, intent.value, date, mappingDate),
        );
      case 'hedge':
        return Math.trunc(
          futureContractsForNotional(
            this.input.engineData,
            code,
            -intent.value * cashExposure,
            date,
            mappingDate,
          ),
        );
    }
  }

  private removeConditionsForClosedPositions(heldBeforeExecution: Set<string>): void {
    const cashPortfolio = this.input.cashPortfolio;
    const book = this.conditionalOrders;

    for (const code of heldBeforeExecution) {
      if (cashPortfolio.positions.has(code)) {
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
    const placedDate = this.decisionDate;

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

interface ConditionalExitCandidate {
  order: Extract<ConditionalOrder, { kind: 'stop_loss' | 'trailing_stop' | 'take_profit' }>;
  triggerPrice: number;
}

function selectConditionalExit(
  orders: ConditionalOrder[],
  bar: { low: number; high: number },
): ConditionalExitCandidate | null {
  const stops: ConditionalExitCandidate[] = [];

  for (const order of orders) {
    if (order.kind === 'stop_loss' && bar.low <= order.triggerPrice) {
      stops.push({ order, triggerPrice: order.triggerPrice });
    } else if (order.kind === 'trailing_stop') {
      const triggerPrice = order.highWater * (1 - order.trailingPct);
      if (bar.low <= triggerPrice) {
        stops.push({ order, triggerPrice });
      }
    }
  }

  stops.sort((left, right) => right.triggerPrice - left.triggerPrice);

  const takeProfit = orders.find(
    (order): order is Extract<ConditionalOrder, { kind: 'take_profit' }> =>
      order.kind === 'take_profit' && bar.high >= order.triggerPrice,
  );

  return (
    stops[0] ?? (takeProfit ? { order: takeProfit, triggerPrice: takeProfit.triggerPrice } : null)
  );
}

function conditionalExitBasePrice(candidate: ConditionalExitCandidate, open: number): number {
  return candidate.order.kind === 'take_profit'
    ? open >= candidate.triggerPrice
      ? open
      : candidate.triggerPrice
    : open <= candidate.triggerPrice
      ? open
      : candidate.triggerPrice;
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
