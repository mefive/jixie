import { cashFinalStateView, type CashFinalStateView } from '#backtesting/result.js';
import type { ConditionalOrderKind } from '#backtesting/order-book.js';
import type { FactorObservation, BacktestingFinalState } from '#backtesting/result.js';

export interface PendingCashSignal {
  code: string;
  assetType: 'stock' | 'etf';
  action: 'buy' | 'sell';
  shares: number;
  refPrice: number;
  refAmount: number;
  source: 'target' | 'order';
  targetWeight?: number;
}

export interface PendingConditionalSignal {
  code: string;
  assetType: 'stock' | 'etf';
  action: 'buy' | 'sell';
  shares: number;
  refPrice: number;
  refAmount: number;
  source: 'conditional';
  conditionId: string;
  orderType: ConditionalOrderKind;
  triggerPrice: number;
  trailingPct?: number;
}

export interface PendingModelPosition {
  code: string;
  assetType: 'stock' | 'etf';
  shares: number;
  markPrice: number;
  sellableFrom: string;
  frozenShares: number;
}

export interface SignalProjection {
  tradeDate: string;
  modelEquity: number;
  modelCash: number;
  modelPositions: PendingModelPosition[];
  signals: Array<PendingCashSignal | PendingConditionalSignal>;
  factorObservations: FactorObservation[];
}

/** Convert a detached final state into next-open signal instructions, without rerunning the strategy. */
export function projectSignals(snapshot: BacktestingFinalState): SignalProjection {
  const state = cashFinalStateView(snapshot);
  const {
    tradeDate,
    positions,
    pendingTargets,
    pendingOrders,
    pendingLotOrders,
    conditionalOrders,
    market,
  } = state;
  const modelEquity = state.equity;
  const modelPositions = [...positions].flatMap(([code, position]) => {
    const adjustmentFactor = market.get(code)?.adjustmentFactor ?? null;
    const markPrice = market.get(code)?.rawClose ?? null;
    if (!adjustmentFactor || !markPrice) {
      return [];
    }
    return [
      {
        code,
        assetType: market.get(code)!.assetType,
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
    const targetCodes = new Set([...positions.keys(), ...pendingTargets.keys()]);
    for (const code of targetCodes) {
      const adjustedClose = market.get(code)?.adjustedClose ?? null;
      const adjustmentFactor = market.get(code)?.adjustmentFactor ?? null;
      const refPrice = market.get(code)?.rawClose ?? null;
      if (adjustedClose == null || adjustedClose <= 0 || !adjustmentFactor || !refPrice) {
        continue;
      }

      const targetWeight = pendingTargets.get(code) ?? 0;
      const targetShares = (targetWeight * modelEquity) / adjustedClose;
      const currentShares = positions.get(code)?.shares ?? 0;
      const signal = projectCashSignal(
        market,
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
      const adjustmentFactor = market.get(code)?.adjustmentFactor ?? null;
      const refPrice = market.get(code)?.rawClose ?? null;
      if (!adjustmentFactor || !refPrice) {
        continue;
      }

      const currentShares = positions.get(code)?.shares ?? 0;
      const executableDelta = delta < 0 ? -Math.min(-delta, currentShares) : delta;
      const signal = projectCashSignal(
        market,
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
      const adjustmentFactor = market.get(code)?.adjustmentFactor ?? null;
      const refPrice = market.get(code)?.rawClose ?? null;
      if (!adjustmentFactor || !refPrice) {
        continue;
      }
      const signal = projectCashSignal(
        market,
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

  for (const [key, order] of conditionalOrders) {
    const adjustmentFactor = market.get(order.code)?.adjustmentFactor ?? null;
    const refPrice = market.get(order.code)?.rawClose ?? null;
    if (!adjustmentFactor || !refPrice) {
      continue;
    }
    const position = positions.get(order.code);
    const action = order.kind === 'limit_buy' ? 'buy' : 'sell';
    const adjustedTrigger =
      order.kind === 'trailing_stop'
        ? order.highWater * (1 - order.trailingPct)
        : order.triggerPrice;
    const triggerPrice = adjustedTrigger / adjustmentFactor;
    let projectedShares = position?.shares ?? 0;
    if (pendingTargets?.has(order.code)) {
      const adjustedClose = market.get(order.code)?.adjustedClose ?? null;
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
      assetType: market.get(order.code)!.assetType,
      action,
      shares: realShares,
      refPrice,
      refAmount: realShares * triggerPrice,
      source: 'conditional',
      conditionId: `${key}:${order.placedDate}`,
      orderType: order.kind,
      triggerPrice,
      ...(order.kind === 'trailing_stop' ? { trailingPct: order.trailingPct } : {}),
    });
  }

  return {
    tradeDate,
    modelEquity,
    modelCash: state.cash,
    modelPositions,
    signals,
    factorObservations: structuredClone(state.factorObservations),
  };
}
function projectCashSignal(
  market: CashFinalStateView['market'],
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
    assetType: market.get(code)!.assetType,
    action: realDelta > 0 ? 'buy' : 'sell',
    shares,
    refPrice,
    refAmount: shares * refPrice,
    source,
    ...(targetWeight == null ? {} : { targetWeight }),
  };
}
