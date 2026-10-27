import { DEFAULT_LOCALE, type Locale } from '@jixie/shared';
import { t } from '#i18n/messages.js';
import { EngineData } from './data/engine-data.js';
import { CashPortfolio } from './cash-portfolio.js';
import type { CostModel } from './cost.js';
import type { AllocationAnalysisTracker } from './allocation-analysis-tracker.js';

/**
 * 装配订单簿所需的行情、账户、成本和执行回调。
 *
 * Supply market, account, cost and execution capabilities to the order book.
 */
interface OrderBookInput {
  locale?: Locale;
  engineData: EngineData;
  cashPortfolio: CashPortfolio;
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
  };
  private readonly conditionalOrders = new Map<string, ConditionalOrder>();

  private readonly locale: Locale;
  private readonly engineData: EngineData;
  private readonly cashPortfolio: CashPortfolio;
  private readonly cost: CostModel;
  private readonly allocationTracker: AllocationAnalysisTracker;
  private readonly onRebalance: (date: string) => void;

  constructor(input: OrderBookInput) {
    this.locale = input.locale ?? DEFAULT_LOCALE;
    this.engineData = input.engineData;
    this.cashPortfolio = input.cashPortfolio;
    this.cost = input.cost;
    this.allocationTracker = input.allocationTracker;
    this.onRebalance = input.onRebalance;
  }

  /**
   * 为下一次策略回调重置决策缓冲并记录决策日，保留待执行订单和有效条件单。
   *
   * Starts a fresh instruction buffer for the strategy's next onBar call and records its decision
   * date.
   * Clears previously collected instructions, leaving pending orders and active conditional orders
   * intact.
   * Subsequent strategy order calls write to this buffer; commitDecision submits it for execution.
   */
  beginDecision(date: string): void {
    this.decisionDate = date;
    this.decision = emptyDecision();
  }

  /**
   * 将本次策略声明提交为后续执行状态，统一调仓与现金指令的生效边界。
   *
   * Commit collected strategy instructions to pending execution state.
   */
  commitDecision(): void {
    validateTargetBook(this.decision.targets);

    // Resolve zero-position targets into the existing snapshot format before publishing the batch.
    for (const code of this.decision.closePositions) {
      if (this.decision.targets) {
        this.decision.targets.set(code, 0);
      } else {
        const shares = this.cashPortfolio.positions.get(code)?.shares ?? 0;
        if (shares) {
          this.decision.shareOrders ??= new Map();
          this.decision.shareOrders.set(code, -shares);
        }
      }
    }

    this.pending.targets = this.decision.targets;
    this.pending.decisionDate = this.decision.targets ? this.decisionDate : null;
    this.pending.shareOrders = this.decision.shareOrders;
    this.pending.lotOrders = this.decision.lotOrders;

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

  /**
   * 返回与内部可变状态分离的现金订单快照。
   *
   * Returns a detached snapshot of cash orders only.
   */
  snapshotCashOrders(): CashOrderSnapshot {
    return structuredClone({
      pendingTargets: this.pending.targets,
      pendingOrders: this.pending.shareOrders,
      pendingLotOrders: this.pending.lotOrders,
      conditionalOrders: this.conditionalOrders,
    });
  }

  /**
   * 在每日结算前执行待成交订单和盘中条件单模拟。
   *
   * Executes pending orders and intraday conditional simulations before daily settlement.
   */
  async executeOrders(date: string): Promise<void> {
    const { cashPortfolio } = this;
    const heldBeforeExecution = new Set(cashPortfolio.positions.keys());

    await this.executePendingRebalance(date);

    await this.executePendingCashOrders(date);

    this.removeConditionsForClosedPositions(heldBeforeExecution);

    await this.executeActiveConditionalOrders(date);
  }

  /**
   * 按待执行目标权重计算并执行调仓，复用账户和市场限制。
   *
   * Execute pending target-weight rebalancing through the account and market constraints.
   */
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

  /**
   * 处理待执行的现金数量指令，将可成交部分交由现金账户记账。
   *
   * Process pending cash share orders and post executable fills to the cash account.
   */
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

  /**
   * 结合当日 OHLC 与条件单规则选择出场，避免停牌或价格限制下的虚假成交。
   *
   * Evaluate active conditional exits against exact-day OHLC and execution constraints.
   */
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

  setStockTargetWeight(code: string, weight: number): void {
    validateTargetWeight(code, weight);
    this.validateCashOrderMode('target');

    this.decision.closePositions.delete(code);
    this.decision.targets ??= new Map();
    this.decision.targets.set(code, weight);
  }

  setStockTargetWeights(weights: Record<string, number> | Map<string, number>): void {
    const targetWeights = new Map(weights instanceof Map ? weights : Object.entries(weights));
    validateTargetBook(targetWeights);
    this.validateCashOrderMode('target');

    this.decision.closePositions.clear();
    this.decision.targets = targetWeights;
  }

  orderStockAdjustedShares(code: string, shares: number): void {
    validateFiniteOrderValue(shares, 'Order shares');
    if (!shares) {
      return;
    }
    this.validateCashOrderMode('delta', code);

    this.decision.shareOrders = collectShareDelta(this.decision.shareOrders, code, shares);
  }

  orderStockLots(code: string, lots: number): void {
    validateFiniteOrderValue(lots, 'Order lots');
    const wholeLots = Math.trunc(lots);
    if (!wholeLots) {
      return;
    }
    this.validateCashOrderMode('delta', code);

    this.decision.lotOrders ??= new Map();
    this.decision.lotOrders.set(code, (this.decision.lotOrders.get(code) ?? 0) + wholeLots);
  }

  closeStockPosition(code: string): void {
    this.decision.shareOrders?.delete(code);
    this.decision.lotOrders?.delete(code);
    this.decision.targets?.set(code, 0);
    this.decision.closePositions.add(code);
  }

  /**
   * 验证现金指令模式与当前决策是否兼容，避免混合冲突。
   *
   * Validate cash order mode against the current decision to avoid conflicting instructions.
   */
  private validateCashOrderMode(mode: 'target' | 'delta', code?: string): void {
    const conflict =
      mode === 'target'
        ? (this.decision.shareOrders?.size ?? 0) > 0 || (this.decision.lotOrders?.size ?? 0) > 0
        : this.decision.targets !== null ||
          (code !== undefined && this.decision.closePositions.has(code));
    if (conflict) {
      throw new Error(
        t(this.locale, 'orderDecisionConflict', { account: 'stock', code: code ?? '*' }),
      );
    }
  }

  setStockStopLossAtAdjustedPrice(code: string, price: number): void {
    validatePositiveOrderValue(price, 'Stop-loss price');
    this.decision.conditionalCommands.push({
      action: 'upsert',
      order: { kind: 'stop_loss', code, triggerPrice: price },
    });
  }

  /**
   * 将跟踪止损比例转换为订单簿条件状态，校验输入。
   *
   * Validate and register a fraction-based cash trailing stop.
   */
  setStockTrailingStopByFraction(code: string, pct: number): void {
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

  setStockLimitBuyAtAdjustedPrice(code: string, price: number, shares: number): void {
    validatePositiveOrderValue(price, 'Limit-buy price');
    validatePositiveOrderValue(shares, 'Limit-buy shares');
    this.decision.conditionalCommands.push({
      action: 'upsert',
      order: { kind: 'limit_buy', code, triggerPrice: price, shares },
    });
  }

  setStockTakeProfitByFraction(code: string, pct: number): void {
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

  cancelStockConditional(code: string, kind?: ConditionalOrderKind): void {
    this.decision.conditionalCommands.push({ action: 'cancel', code, kind });
  }

  /**
   * 将目标权重转换为可执行的现金资产调整，按持仓与买入预算处理调仓。
   *
   * Translate target weights into cash-asset adjustments using holdings and available purchase
   * budgets.
   */
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

  /**
   * 在仓位关闭后清理对应条件单，避免无持仓触发退出。
   *
   * Remove conditional exits associated with positions that are now closed.
   */
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

  /**
   * 按方向、触发价和当日限价判断条件成交是否受阻。
   *
   * Check conditional fills against side, trigger price and daily price limits.
   */
  private conditionalLimitBlocked(
    code: string,
    date: string,
    side: 'buy' | 'sell',
    bar: { high: number; low: number },
  ): boolean {
    const limit = this.engineData.priceLimitsOn(code, date);
    const adjustmentFactor = this.engineData.adjustmentFactorOn(code, date);
    if (
      !limit ||
      !adjustmentFactor ||
      adjustmentFactor <= 0 ||
      (side === 'buy' ? limit.up : limit.down) == null
    ) {
      return this.engineData.assetType(code) === 'stock';
    }
    const epsilon = 1e-3;

    return side === 'buy'
      ? limit.up != null && bar.low / adjustmentFactor >= limit.up - epsilon
      : limit.down != null && bar.high / adjustmentFactor <= limit.down + epsilon;
  }

  private sellableFromFor(code: string, date: string): string {
    return this.engineData.supportsSameDayTurnover(code) ? date : this.engineData.nextDay(date);
  }

  /**
   * 结合基准价、滑点和冲击计算不利成交价，保持方向一致。
   *
   * Compute an adverse execution price from reference, slippage and impact.
   */
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

  /**
   * 判断指定方向的成交是否受当日涨跌停约束。
   *
   * Determine whether daily price limits block a fill in the requested direction.
   */
  private limitBlocked(
    code: string,
    date: string,
    side: 'buy' | 'sell',
    adjustedPrice: number,
  ): boolean {
    const limits = this.engineData.priceLimitsOn(code, date);
    if (!limits || (side === 'buy' ? limits.up : limits.down) == null) {
      return this.engineData.assetType(code) === 'stock';
    }
    const adjustmentFactor = this.engineData.adjustmentFactorOn(code, date);
    if (adjustmentFactor == null || adjustmentFactor <= 0) {
      return true;
    }
    const rawOpen = adjustedPrice / adjustmentFactor;
    const epsilon = 1e-3;

    return side === 'buy'
      ? limits.up != null && rawOpen >= limits.up - epsilon
      : limits.down != null && rawOpen <= limits.down + epsilon;
  }
}

/**
 * 保存盘中条件退出的触发价、类型与证券身份，供当日 OHLC 撮合。
 *
 * Represent an active conditional exit and its trigger for intraday OHLC simulation.
 */
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

/**
 * 冻结现金待执行订单与条件单状态，供末日状态检查。
 *
 * Snapshot pending cash orders and conditional exits for final-state inspection.
 */
export interface CashOrderSnapshot {
  pendingTargets: Map<string, number> | null;
  pendingOrders: Map<string, number> | null;
  pendingLotOrders: Map<string, number> | null;
  conditionalOrders: Map<string, ConditionalOrder>;
}

/**
 * 描述条件单的新增或撤销意图，供决策缓冲统一提交。
 *
 * Describe conditional-order changes collected during a strategy decision.
 */
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

/**
 * 汇总一次策略回调产生的调仓、现金与条件指令。
 *
 * Collect rebalance, cash and conditional instructions from one strategy callback.
 */
interface OrderDecision {
  closePositions: Set<string>;
  targets: Map<string, number> | null;
  shareOrders: Map<string, number> | null;
  lotOrders: Map<string, number> | null;
  conditionalCommands: ConditionalCommand[];
}

/**
 * 维护已提交但尚待执行的订单集合，区分决策与成交时序。
 *
 * Retain committed orders awaiting execution, separating decision time from fill time.
 */
interface PendingOrders {
  decisionDate: string | null;
  targets: Map<string, number> | null;
  shareOrders: Map<string, number> | null;
  lotOrders: Map<string, number> | null;
}

/**
 * 承载单个条件退出的候选成交价格与触发类型，供冲突选择。
 *
 * Describe a candidate conditional fill and trigger for deterministic exit selection.
 */
interface ConditionalExitCandidate {
  order: Extract<ConditionalOrder, { kind: 'stop_loss' | 'trailing_stop' | 'take_profit' }>;
  triggerPrice: number;
}

function emptyDecision(): OrderDecision {
  return {
    closePositions: new Set(),
    targets: null,
    shareOrders: null,
    lotOrders: null,
    conditionalCommands: [],
  };
}

/**
 * 在同日多个退出条件之间按现有规则选择成交，统一止损与止盈冲突处理。
 *
 * Select a conditional fill when multiple exit triggers compete within one day.
 */
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

/**
 * 验证目标权重集合的证券与数值约束，供策略及重放入口共用。
 *
 * Validate instrument and numeric constraints on target weights for strategy and replay callers.
 */
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

/**
 * 规范化并累积复权数量变化，供策略决策使用。
 *
 * Normalize and accumulate adjusted-share deltas from strategy decisions.
 */
function collectShareDelta(
  orders: Map<string, number> | null,
  code: string,
  shares: number,
): Map<string, number> | null {
  validateFiniteOrderValue(shares, 'Order shares');
  if (!shares) {
    return orders;
  }

  const result = orders ?? new Map<string, number>();
  result.set(code, (result.get(code) ?? 0) + shares);

  return result;
}
