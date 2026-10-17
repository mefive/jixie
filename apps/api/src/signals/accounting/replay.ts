import type { CostModel } from '#backtesting/cost.js';

/**
 * 区分模型账户与实际账户，供同一重放算法选择输入。
 *
 * Distinguish model and actual accounts when selecting replay inputs.
 */
export type AccountKind = 'simulation' | 'actual';

/**
 * 限定信号现金账户中的股票和 ETF，供费用与数量规则分派。
 *
 * Identify stock and ETF cash assets for fee and sizing rules.
 */
type CashAssetType = 'stock' | 'etf';

/**
 * 描述可重放账户的持仓、成本与冻结状态。
 *
 * Describe holdings, cost bases and frozen quantities in a replayable account.
 */
export interface AccountPosition {
  code: string;
  name: string;
  assetType: CashAssetType;
  shares: number;
  avgCost: number;
  markPrice: number;
  sellableFrom: string;
  frozenShares?: number;
}

/**
 * 封装重放起点或结果的现金和持仓，供逐日结转。
 *
 * Carry cash and holdings between replayed account days.
 */
export interface AccountState {
  cash: number;
  positions: AccountPosition[];
}

/**
 * 保存执行日原始价格与交易约束，供纯账本重放。
 *
 * Supply execution-day raw prices and trading constraints to pure ledger replay.
 */
export interface MarketQuote {
  open: number | null;
  close: number | null;
  amount: number | null;
  upLimit: number | null;
  downLimit: number | null;
}

/**
 * 规范化待重放订单及其方向、数量和来源。
 *
 * Describe a normalized order, side, quantity and source for ledger replay.
 */
export interface ReplayOrder {
  id: string;
  code: string;
  name: string;
  assetType: CashAssetType;
  action: 'buy' | 'sell';
  requestedShares: number;
  actualStatus: string;
  actualShares: number | null;
  actualPrice: number | null;
  actualFee: number | null;
}

/**
 * 承载模拟执行变化，供持久化执行状态与账户结果。
 *
 * Describe simulated execution updates persisted alongside account results.
 */
interface SimulationUpdate {
  id: string;
  status: 'filled' | 'blocked';
  shares: number | null;
  price: number | null;
  fee: number | null;
  slippage: number | null;
  reason: string | null;
}

const MAX_SLIPPAGE = 0.1;

/**
 * 按输入账户、订单及行情纯重放一天交易，统一费用、冻结与持仓更新。
 *
 * Replay one day from account state, orders and quotes with consistent fees, freezing and position updates.
 */
export function replayAccountDay(
  prior: AccountState,
  orders: ReplayOrder[],
  quotes: Map<string, MarketQuote>,
  tradeDate: string,
  nextDate: string,
  cost: CostModel,
  kind: AccountKind,
): { state: AccountState; simulationUpdates: SimulationUpdate[] } {
  const state: AccountState = {
    cash: prior.cash,
    positions: prior.positions.map((position) => ({ ...position })),
  };
  const positions = new Map(state.positions.map((position) => [position.code, position]));
  const simulationUpdates: SimulationUpdate[] = [];
  const ordered = [...orders].sort((left, right) => {
    if (left.action === right.action) {
      return 0;
    }
    return left.action === 'sell' ? -1 : 1;
  });

  for (const order of ordered) {
    if (kind === 'actual' && order.actualStatus !== 'filled') {
      continue;
    }
    const quote = quotes.get(order.code);
    const requestedShares = kind === 'actual' ? (order.actualShares ?? 0) : order.requestedShares;
    const marketPrice = quote?.open ?? null;
    if (kind === 'simulation' && (marketPrice == null || marketPrice <= 0)) {
      simulationUpdates.push(blockedUpdate(order.id, 'suspended'));
      continue;
    }
    if (
      kind === 'simulation' &&
      limitBlocked(order.action, marketPrice!, quote?.upLimit ?? null, quote?.downLimit ?? null)
    ) {
      simulationUpdates.push(
        blockedUpdate(order.id, order.action === 'buy' ? 'up_limit' : 'down_limit'),
      );
      continue;
    }

    const position = positions.get(order.code);
    if (position && position.sellableFrom <= tradeDate) {
      position.frozenShares = 0;
    }
    let shares = requestedShares;
    if (order.action === 'sell') {
      const sellable = position ? accountSellableShares(position, tradeDate) : 0;
      if (!position || sellable <= 0) {
        if (kind === 'simulation') {
          simulationUpdates.push(blockedUpdate(order.id, 'position_unavailable'));
        }
        continue;
      }
      shares = Math.min(shares, sellable);
    }
    const fillPrice =
      kind === 'actual'
        ? order.actualPrice!
        : simulatedPrice(order.action, marketPrice!, shares * marketPrice!, quote?.amount, cost);
    if (order.action === 'buy' && kind === 'simulation') {
      shares = Math.min(shares, affordableShares(state.cash, fillPrice, order.assetType, cost));
    }
    if (shares <= 0 || fillPrice <= 0) {
      if (kind === 'simulation') {
        simulationUpdates.push(blockedUpdate(order.id, 'insufficient_cash'));
      }
      continue;
    }

    const value = shares * fillPrice;
    const fee =
      kind === 'actual' && order.actualFee != null
        ? order.actualFee
        : executionFee(order.action, value, order.assetType, cost);
    if (order.action === 'buy') {
      state.cash -= value + fee;
      const nextPosition = position ?? {
        code: order.code,
        name: order.name,
        assetType: order.assetType,
        shares: 0,
        avgCost: 0,
        markPrice: fillPrice,
        sellableFrom: nextDate,
        frozenShares: 0,
      };
      const existingFrozen =
        nextPosition.sellableFrom > tradeDate
          ? (nextPosition.frozenShares ?? nextPosition.shares)
          : 0;
      nextPosition.avgCost =
        (nextPosition.avgCost * nextPosition.shares + value + fee) / (nextPosition.shares + shares);
      nextPosition.shares += shares;
      nextPosition.markPrice = fillPrice;
      nextPosition.sellableFrom = nextDate;
      nextPosition.frozenShares = nextDate > tradeDate ? existingFrozen + shares : 0;
      positions.set(order.code, nextPosition);
    } else {
      state.cash += value - fee;
      position!.shares -= shares;
      position!.markPrice = fillPrice;
      if (position!.shares < 1e-6) {
        positions.delete(order.code);
      }
    }
    if (kind === 'simulation') {
      simulationUpdates.push({
        id: order.id,
        status: 'filled',
        shares,
        price: fillPrice,
        fee,
        slippage: Math.abs(fillPrice - marketPrice!) * shares,
        reason: shares < order.requestedShares ? 'partial' : null,
      });
    }
  }

  for (const position of positions.values()) {
    const close = quotes.get(position.code)?.close;
    if (close != null && close > 0) {
      position.markPrice = close;
    }
  }
  state.positions = [...positions.values()].sort((left, right) =>
    left.code.localeCompare(right.code),
  );
  return { state, simulationUpdates };
}

/**
 * 按方向将滑点施加于参考价，供模拟成交。
 *
 * Apply side-aware slippage to a reference price for simulated fills.
 */
function simulatedPrice(
  action: 'buy' | 'sell',
  open: number,
  notional: number,
  amountThousandYuan: number | null | undefined,
  cost: CostModel,
): number {
  const base = cost.slippageBps / 10_000;
  const turnover = (amountThousandYuan ?? 0) * 1000;
  const impact = turnover > 0 ? cost.impactCoef * (notional / turnover) : 0;
  const slippage = Math.min(base + impact, MAX_SLIPPAGE);
  return action === 'buy' ? open * (1 + slippage) : open * (1 - slippage);
}

/**
 * 按资产与方向计算佣金、印花税和过户费。
 *
 * Calculate commissions and asset-specific taxes and transfer fees.
 */
function executionFee(
  action: 'buy' | 'sell',
  value: number,
  assetType: CashAssetType,
  cost: CostModel,
): number {
  const commission = Math.max(value * cost.commission, cost.minCommission);
  const transfer = assetType === 'stock' ? value * cost.transferFee : 0;
  const stamp = action === 'sell' && assetType === 'stock' ? value * cost.stampDuty : 0;
  return commission + transfer + stamp;
}

/**
 * 计算扣除费用后可承担的整手买入量，供模拟账户执行。
 *
 * Compute affordable whole-lot purchases after fees for simulated execution.
 */
function affordableShares(
  cash: number,
  price: number,
  assetType: CashAssetType,
  cost: CostModel,
): number {
  if (!Number.isFinite(cash) || !Number.isFinite(price) || cash <= 0 || price <= 0) {
    return 0;
  }
  let low = 0;
  let high = Math.max(0, Math.floor(cash / (price * 100)));
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const value = middle * 100 * price;
    if (value + executionFee('buy', value, assetType, cost) <= cash + 1e-9) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low * 100;
}

function accountSellableShares(position: AccountPosition, tradeDate: string): number {
  const frozen = position.sellableFrom > tradeDate ? (position.frozenShares ?? position.shares) : 0;
  return Math.max(0, position.shares - Math.min(position.shares, frozen));
}

function limitBlocked(
  action: 'buy' | 'sell',
  open: number,
  upLimit: number | null,
  downLimit: number | null,
): boolean {
  const epsilon = 1e-3;
  return action === 'buy'
    ? upLimit != null && open >= upLimit - epsilon
    : downLimit != null && open <= downLimit + epsilon;
}

function blockedUpdate(id: string, reason: string): SimulationUpdate {
  return {
    id,
    status: 'blocked',
    shares: null,
    price: null,
    fee: null,
    slippage: null,
    reason,
  };
}
