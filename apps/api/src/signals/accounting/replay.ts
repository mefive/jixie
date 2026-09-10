import type { CostModel } from '#engine/types.js';

export type AccountKind = 'simulation' | 'actual';

type CashAssetType = 'stock' | 'etf';

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

export interface AccountState {
  cash: number;
  positions: AccountPosition[];
}

export interface MarketQuote {
  open: number | null;
  close: number | null;
  amount: number | null;
  upLimit: number | null;
  downLimit: number | null;
}

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
