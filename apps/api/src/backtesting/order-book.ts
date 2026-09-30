import { EngineData } from './data/engine-data.js';
import { CashPortfolio } from './cash-portfolio.js';
import { FuturesPortfolio } from './futures-portfolio.js';
import type { CostModel } from './cost.js';
import type { AllocationAnalysisTracker } from './allocation-analysis.js';

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
  private readonly pending: PendingOrders = {
    decisionDate: null,
    targets: null,
    shareOrders: null,
    lotOrders: null,
    futureIntents: null,
  };
  private readonly conditionalOrders = new Map<string, ConditionalOrder>();

  private readonly engineData: EngineData;
  private readonly cashPortfolio: CashPortfolio;
  private readonly futuresPortfolio: FuturesPortfolio;
  private readonly cost: CostModel;
  private readonly allocationTracker: AllocationAnalysisTracker;
  private readonly onRebalance: (date: string) => void;

  constructor(input: OrderBookInput) {
    this.engineData = input.engineData;
    this.cashPortfolio = input.cashPortfolio;
    this.futuresPortfolio = input.futuresPortfolio;
    this.cost = input.cost;
    this.allocationTracker = input.allocationTracker;
    this.onRebalance = input.onRebalance;
  }

  /**
   * Starts a fresh instruction buffer for the strategy's next onBar call and records its decision date.
   * Clears previously collected instructions, leaving pending orders and active conditional orders intact.
   * Subsequent strategy order calls write to this buffer; commitDecision submits it for execution.
   */
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

  /** Returns a detached snapshot of cash orders only. */
  snapshotCashOrders(): CashOrderSnapshot {
    return structuredClone({
      pendingTargets: this.pending.targets,
      pendingOrders: this.pending.shareOrders,
      pendingLotOrders: this.pending.lotOrders,
      conditionalOrders: this.conditionalOrders,
    });
  }

  snapshotFuturesOrders(): Array<{ code: string; intent: FutureIntent }> {
    return structuredClone(
      [...(this.pending.futureIntents ?? [])].map(([code, intent]) => ({ code, intent })),
    );
  }

  /** Replaces execution state for forward simulation, without collecting a strategy decision. */
  loadExecutionOrders({ cashOrders, futuresOrders }: ExecutionOrdersInput): void {
    const cashSnapshot = structuredClone(cashOrders);
    let futureIntents: Map<string, FutureIntent> | null = null;
    for (const { code, intent } of futuresOrders) {
      futureIntents = collectFutureIntent(futureIntents, code, intent);
    }

    // Forward cash instructions have no target-rebalance attribution decision.
    this.pending.decisionDate = null;
    this.pending.targets = cashSnapshot.pendingTargets;
    this.pending.shareOrders = cashSnapshot.pendingOrders;
    this.pending.lotOrders = cashSnapshot.pendingLotOrders;
    this.pending.futureIntents = futureIntents;

    this.conditionalOrders.clear();
    for (const [key, order] of cashSnapshot.conditionalOrders) {
      this.conditionalOrders.set(key, order);
    }
  }

  /** Executes pending orders and intraday conditional simulations before daily settlement. */
  async executeOrders(date: string, previousDate: string | undefined): Promise<void> {
    const { engineData, cashPortfolio, futuresPortfolio } = this;
    const heldBeforeExecution = new Set(cashPortfolio.positions.keys());

    if (previousDate) {
      for (const code of new Set([
        ...futuresPortfolio.positions.keys(),
        ...(this.pending.futureIntents?.keys() ?? []),
      ])) {
        const intent = this.pending.futureIntents?.get(code);
        const held = futuresPortfolio.positions.get(code);
        const closingActualCode =
          intent?.kind === 'contracts' && intent.value === 0 ? held?.actualCode : undefined;
        engineData.assertFutureExecution(code, previousDate, date, closingActualCode);
      }
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
    const { engineData, cashPortfolio, allocationTracker, onRebalance } = this;
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

    await this.engineData.loadBars([
      ...new Set([...(shareOrders?.keys() ?? []), ...(lotOrders?.keys() ?? [])]),
    ]);

    const { cashPortfolio, engineData } = this;
    const orders = new Map(this.pending.shareOrders ?? []);
    for (const [code, lots] of this.pending.lotOrders ?? []) {
      const adjustmentFactor = this.engineData.adjustmentFactorOn(code, date);
      if (adjustmentFactor == null || adjustmentFactor <= 0) {
        continue;
      }
      const adjustedShares = (lots * 100) / adjustmentFactor;
      orders.set(code, (orders.get(code) ?? 0) + adjustedShares);
    }

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
      if (sell > 0 && !this.limitBlocked(code, date, 'sell', price)) {
        const fillPrice = this.executionPrice(code, date, 'sell', price, sell * price);
        cashPortfolio.fill({
          code,
          adjustedShareDelta: -sell,
          adjustedPrice: fillPrice,
          date,
          sellableFrom: this.sellableFromFor(code, date),
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
      if (this.limitBlocked(code, date, 'buy', price)) {
        continue;
      } // up-limit sealed — can't buy
      // Slippage lifts the buy price → size affordability on the slipped price so we don't overspend.
      const fillPrice = this.executionPrice(code, date, 'buy', price, delta * price);
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
          sellableFrom: this.sellableFromFor(code, date),
          adjustmentFactor,
          assetType,
          referenceAdjustedPrice: price,
        });
      }
    }

    this.pending.shareOrders = null;
    this.pending.lotOrders = null;
  }

  private async executeActiveConditionalOrders(date: string): Promise<void> {
    if (this.conditionalOrders.size === 0) {
      return;
    }

    await this.engineData.loadBars([
      ...new Set([...this.conditionalOrders.values()].map((order) => order.code)),
    ]);

    const { cashPortfolio, engineData } = this;
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
        !this.conditionalLimitBlocked(code, date, 'sell', bar)
      ) {
        const isProfit = exitCandidate.order.kind === 'take_profit';
        const basePrice = isProfit
          ? bar.open >= exitCandidate.triggerPrice
            ? bar.open
            : exitCandidate.triggerPrice
          : bar.open <= exitCandidate.triggerPrice
            ? bar.open
            : exitCandidate.triggerPrice;
        const slippedPrice = this.executionPrice(
          code,
          date,
          'sell',
          basePrice,
          sellableShares * basePrice,
        );
        const fillPrice = isProfit
          ? Math.max(exitCandidate.triggerPrice, slippedPrice)
          : slippedPrice;
        cashPortfolio.fill({
          source: exitCandidate.order.kind,
          code,
          adjustedShareDelta: -sellableShares,
          adjustedPrice: fillPrice,
          date,
          sellableFrom: this.sellableFromFor(code, date),
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
        if (this.conditionalLimitBlocked(code, date, 'buy', bar)) {
          continue;
        }
        const basePrice = bar.open <= order.triggerPrice ? bar.open : order.triggerPrice;
        const slippedPrice = this.executionPrice(
          code,
          date,
          'buy',
          basePrice,
          order.shares * basePrice,
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
          source: 'limit_buy',
          code,
          adjustedShareDelta: buy,
          adjustedPrice: fillPrice,
          date,
          sellableFrom: this.sellableFromFor(code, date),
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
    validateFiniteOrderValue(shares, 'Order shares');
    if (!shares) {
      return;
    }
    this.decision.shareOrders ??= new Map();
    this.decision.shareOrders.set(code, (this.decision.shareOrders.get(code) ?? 0) + shares);
  }

  orderLots(code: string, lots: number): void {
    validateFiniteOrderValue(lots, 'Order lots');
    const wholeLots = Math.trunc(lots);
    if (!wholeLots) {
      return;
    }
    this.decision.lotOrders ??= new Map();
    this.decision.lotOrders.set(code, (this.decision.lotOrders.get(code) ?? 0) + wholeLots);
  }

  exit(code: string): void {
    const held = this.cashPortfolio.positions.get(code)?.shares ?? 0;
    if (!held) {
      return;
    }
    this.decision.shareOrders ??= new Map();
    this.decision.shareOrders.set(code, (this.decision.shareOrders.get(code) ?? 0) - held);
  }

  stopLoss(code: string, price: number): void {
    validatePositiveOrderValue(price, 'Stop-loss price');
    this.decision.conditionalCommands.push({
      action: 'upsert',
      order: { kind: 'stop_loss', code, triggerPrice: price },
    });
  }

  trailingStop(code: string, pct: number): void {
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 1) {
      throw new Error('Trailing-stop percentage must be between 0 and 1');
    }

    const highWater = this.engineData.adjustedCloseAsOf(code, this.decisionDate);
    if (highWater == null || highWater <= 0) {
      return;
    }
    this.decision.conditionalCommands.push({
      action: 'upsert',
      order: { kind: 'trailing_stop', code, trailingPct: pct, highWater },
    });
  }

  limitBuy(code: string, price: number, shares: number): void {
    validatePositiveOrderValue(price, 'Limit-buy price');
    validatePositiveOrderValue(shares, 'Limit-buy shares');
    this.decision.conditionalCommands.push({
      action: 'upsert',
      order: { kind: 'limit_buy', code, triggerPrice: price, shares },
    });
  }

  takeProfit(code: string, pct: number): void {
    validatePositiveOrderValue(pct, 'Take-profit percentage');
    const position = this.cashPortfolio.positions.get(code);
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
    this.decision.futureIntents = collectFutureIntent(this.decision.futureIntents, code, {
      kind: 'delta',
      value: contracts,
    });
  }

  setFutureTargetContracts(code: string, contracts: number): void {
    this.decision.futureIntents = collectFutureIntent(this.decision.futureIntents, code, {
      kind: 'contracts',
      value: contracts,
    });
  }

  setFutureTargetNotional(code: string, notional: number): void {
    this.decision.futureIntents = collectFutureIntent(this.decision.futureIntents, code, {
      kind: 'notional',
      value: notional,
    });
  }

  hedgeFuture(code: string, beta = 1): void {
    this.decision.futureIntents = collectFutureIntent(this.decision.futureIntents, code, {
      kind: 'hedge',
      value: beta,
    });
  }

  exitFuture(code: string): void {
    this.decision.futureIntents ??= new Map();
    this.decision.futureIntents.set(code, { kind: 'contracts', value: 0 });
  }

  private rebalance(date: string): void {
    const { cashPortfolio, engineData } = this;
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
      if (target < position.shares && !this.limitBlocked(code, date, 'sell', price)) {
        const sell = Math.min(position.shares - target, cashPortfolio.sellableShares(code, date));
        if (sell <= 0) {
          continue;
        }
        const fillPrice = this.executionPrice(code, date, 'sell', price, sell * price);
        cashPortfolio.fill({
          code,
          adjustedShareDelta: -sell,
          adjustedPrice: fillPrice,
          date,
          sellableFrom: this.sellableFromFor(code, date),
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
      if (target > currentShares && !this.limitBlocked(code, date, 'buy', price)) {
        const delta = target - currentShares;
        const fillPrice = this.executionPrice(code, date, 'buy', price, delta * price);
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
          sellableFrom: this.sellableFromFor(code, date),
          adjustmentFactor,
          assetType: engineData.assetType(code),
          referenceAdjustedPrice: price,
        });
      }
    }
  }

  private executePendingFutureIntents(date: string, mappingDate: string): void {
    const { futuresPortfolio, cashPortfolio, engineData } = this;
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
        return Math.trunc(this.futureContractsForNotional(code, intent.value, date, mappingDate));
      case 'hedge':
        return Math.trunc(
          this.futureContractsForNotional(code, -intent.value * cashExposure, date, mappingDate),
        );
    }
  }

  private removeConditionsForClosedPositions(heldBeforeExecution: Set<string>): void {
    const cashPortfolio = this.cashPortfolio;
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

  private conditionalLimitBlocked(
    code: string,
    date: string,
    side: 'buy' | 'sell',
    bar: { high: number; low: number },
  ): boolean {
    const limit = this.engineData.priceLimitsOn(code, date);
    const adjustmentFactor = this.engineData.adjustmentFactorOn(code, date);
    if (!limit || !adjustmentFactor || adjustmentFactor <= 0) {
      return false;
    }
    const epsilon = 1e-3;

    return side === 'buy'
      ? limit.up != null && bar.low / adjustmentFactor >= limit.up - epsilon
      : limit.down != null && bar.high / adjustmentFactor <= limit.down + epsilon;
  }

  private futureContractsForNotional(
    code: string,
    notional: number,
    date: string,
    mappingDate: string,
  ): number {
    const actualCode = this.engineData.futureExecutionCode(code, mappingDate, date);
    if (!actualCode) {
      return 0;
    }
    const bar = this.engineData.futureActualBar(actualCode, date);
    if (bar?.open == null || bar.open <= 0 || bar.multiplier <= 0) {
      return 0;
    }

    return Math.round(notional / (bar.open * bar.multiplier));
  }

  private sellableFromFor(code: string, date: string): string {
    return this.engineData.supportsSameDayTurnover(code) ? date : this.engineData.nextDay(date);
  }

  private executionPrice(
    code: string,
    date: string,
    side: 'buy' | 'sell',
    adjustedPrice: number,
    notionalYuan: number,
  ): number {
    const base = this.cost.slippageBps / 1e4;
    const dayTurnoverYuan = (this.engineData.turnoverOn(code, date) ?? 0) * 1000; // amount is in thousand yuan
    const impact =
      dayTurnoverYuan > 0 ? this.cost.impactCoef * (notionalYuan / dayTurnoverYuan) : 0;
    const slip = Math.min(base + impact, MAX_SLIPPAGE);

    return side === 'buy' ? adjustedPrice * (1 + slip) : adjustedPrice * (1 - slip);
  }

  private limitBlocked(
    code: string,
    date: string,
    side: 'buy' | 'sell',
    adjustedPrice: number,
  ): boolean {
    const limits = this.engineData.priceLimitsOn(code, date);
    if (!limits) {
      return false;
    }
    const adjustmentFactor = this.engineData.adjustmentFactorOn(code, date);
    if (adjustmentFactor == null || adjustmentFactor <= 0) {
      return false;
    }
    const rawOpen = adjustedPrice / adjustmentFactor;
    const epsilon = 1e-3;

    return side === 'buy'
      ? limits.up != null && rawOpen >= limits.up - epsilon
      : limits.down != null && rawOpen <= limits.down + epsilon;
  }
}

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

export type ConditionalOrderKind = ConditionalOrder['kind'];

export type FutureIntent =
  | { kind: 'delta'; value: number }
  | { kind: 'contracts'; value: number }
  | { kind: 'notional'; value: number }
  | { kind: 'hedge'; value: number };

export interface CashOrderSnapshot {
  pendingTargets: Map<string, number> | null;
  pendingOrders: Map<string, number> | null;
  pendingLotOrders: Map<string, number> | null;
  conditionalOrders: Map<string, ConditionalOrder>;
}

interface ExecutionOrdersInput {
  cashOrders: CashOrderSnapshot;
  futuresOrders: ReadonlyArray<{ code: string; intent: FutureIntent }>;
}

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

interface ConditionalExitCandidate {
  order: Extract<ConditionalOrder, { kind: 'stop_loss' | 'trailing_stop' | 'take_profit' }>;
  triggerPrice: number;
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

function validatePositiveOrderValue(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number`);
  }
}

function validateFiniteOrderValue(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be finite`);
  }
}

function conditionalOrderKey(kind: ConditionalOrderKind, code: string): string {
  return `${kind}:${code}`;
}

/** Apply identical validation and ordered accumulation to strategy and loaded futures instructions. */
function collectFutureIntent(
  intents: Map<string, FutureIntent> | null,
  code: string,
  intent: FutureIntent,
): Map<string, FutureIntent> | null {
  let value = intent.value;
  switch (intent.kind) {
    case 'delta': {
      validateFiniteOrderValue(value, 'Futures contracts');
      value = Math.trunc(value);
      if (!value) {
        return intents;
      }
      const prior = intents?.get(code);
      if (prior?.kind === 'delta') {
        value += prior.value;
      }
      break;
    }
    case 'contracts':
      validateFiniteOrderValue(value, 'Futures target contracts');
      value = Math.trunc(value);
      break;
    case 'notional':
      validateFiniteOrderValue(value, 'Futures target notional');
      break;
    case 'hedge':
      if (!Number.isFinite(value) || value < 0) {
        throw new Error('Futures hedge beta must be a finite non-negative number');
      }
      break;
  }

  const result = intents ?? new Map<string, FutureIntent>();
  result.set(code, { kind: intent.kind, value });

  return result;
}
