import type { SignalAccounts, SignalItem, FutureSignalItem } from '@jixie/shared';
import { CashPortfolio } from '#backtesting/cash-portfolio.js';
import { FuturesPortfolio } from '#backtesting/futures-portfolio.js';
import { OrderBook, type ConditionalOrder } from '#backtesting/order-book.js';
import { AllocationAnalysisTracker } from '#backtesting/allocation-analysis.js';
import {
  applyFutureFill,
  normalizeFutureMargin,
  settleFuturePosition,
} from '#backtesting/futures-accounting.js';
import type { EngineData } from '#backtesting/data/engine-data.js';
import type { CostModel } from '#backtesting/cost.js';
import type { TradeRecord } from '#backtesting/trade.js';
import type { SignalFillInput } from '@jixie/shared/api/signals';
import { SignalsError } from '../errors.js';

export interface AccountDayInput {
  prior: SignalAccounts;
  date: string;
  previousDate: string;
  data: EngineData;
  cost: CostModel;
  intents: Array<SignalItem | FutureSignalItem>;
  conditions?: SignalAccounts['conditions'];
}

export async function simulateAccountDay(input: AccountDayInput): Promise<{
  state: SignalAccounts;
  trades: TradeRecord[];
  cashTrace: Array<{ trade: TradeRecord; source: string }>;
}> {
  const { prior, date, previousDate, data, cost } = input;
  const cashTrace: Array<{ trade: TradeRecord; source: string }> = [];
  const cash = new CashPortfolio(prior.cash, cost, (trade, source) =>
    cashTrace.push({ trade, source }),
  );
  cash.positions = new Map(prior.positions.map((position) => [position.code, { ...position }]));
  const futures = new FuturesPortfolio(prior.futures.equity, cost);
  for (const position of prior.futures.positions) {
    futures.positions.set(position.code, { ...position });
  }
  const orderBook = new OrderBook({
    engineData: data,
    cashPortfolio: cash,
    futuresPortfolio: futures,
    cost,
    allocationTracker: new AllocationAnalysisTracker(0, new Map()),
    onRebalance: () => {},
  });
  const conditions = (input.conditions ?? prior.conditions)
    .filter(
      (condition) => !prior.consumedConditions.includes(`${condition.key}:${condition.placedDate}`),
    )
    .map((condition) => {
      const previous = prior.conditions.find(
        (row) => row.key === condition.key && row.placedDate === condition.placedDate,
      );
      return condition.kind === 'trailing_stop' && previous
        ? { ...condition, highWater: previous.highWater }
        : condition;
    });
  const shares = new Map<string, number>();
  for (const intent of input.intents) {
    if (intent.assetType === 'future' || intent.source === 'conditional') {
      continue;
    }
    const adj = data.adjustmentFactorAsOf(intent.code, date);
    if (!adj) {
      throw new SignalsError('data_not_ready', {
        params: { date },
        details: { code: intent.code },
      });
    }
    shares.set(
      intent.code,
      (shares.get(intent.code) ?? 0) + ((intent.action === 'buy' ? 1 : -1) * intent.shares) / adj,
    );
  }
  orderBook.restoreCashOrders({
    pendingTargets: null,
    pendingOrders: shares,
    pendingLotOrders: null,
    conditionalOrders: new Map(
      conditions.map(({ key, ...condition }) => [key, condition as ConditionalOrder]),
    ),
  });
  orderBook.beginOrderCollection(previousDate);
  for (const intent of input.intents) {
    if (intent.assetType !== 'future') {
      continue;
    }
    switch (intent.intent.kind) {
      case 'delta':
        orderBook.orderFuture(intent.code, intent.intent.value);
        break;
      case 'contracts':
        orderBook.setFutureTargetContracts(intent.code, intent.intent.value);
        break;
      case 'notional':
        orderBook.setFutureTargetNotional(intent.code, intent.intent.value);
        break;
      case 'hedge':
        orderBook.hedgeFuture(intent.code, intent.intent.value);
        break;
      case 'roll':
        break;
    }
  }
  // Commit the future collection, then restore the independent cash reference quantities.
  orderBook.commitCollectedOrders();
  orderBook.restoreCashOrders({
    pendingTargets: null,
    pendingOrders: shares,
    pendingLotOrders: null,
    conditionalOrders: new Map(
      conditions.map(({ key, ...condition }) => [key, condition as ConditionalOrder]),
    ),
  });
  assertFutureInputs(input, futures.positions.values());
  await orderBook.executeOrders(date, previousDate);
  futures.settle(data, date);
  const remaining = orderBook.snapshotCashOrders().conditionalOrders;
  const consumed = [
    ...new Set([
      ...prior.consumedConditions,
      ...conditions
        .filter((condition) => !remaining.has(condition.key))
        .map((condition) => `${condition.key}:${condition.placedDate}`),
    ]),
  ];
  const state: SignalAccounts = {
    version: 2,
    date,
    cash: cash.cash,
    positions: [...cash.positions].map(([code, position]) => {
      const previous = prior.positions.find((row) => row.code === code);
      const markPrice = data.adjustedCloseAsOf(code, date) ?? previous?.markPrice;
      const adjustmentFactor = data.adjustmentFactorAsOf(code, date) ?? previous?.adjustmentFactor;
      if (!markPrice || !adjustmentFactor) {
        throw new SignalsError('data_not_ready', { params: { date } });
      }
      return {
        code,
        ...position,
        frozenShares: position.frozenShares ?? position.shares,
        markPrice,
        adjustmentFactor,
        assetType: data.assetType(code),
      };
    }),
    futures: {
      equity: futures.cash,
      margin: futures.margin,
      availableCash: futures.availableCash,
      positions: structuredClone([...futures.positions.values()]),
    },
    conditions: [...remaining].map(([key, condition]) => ({ key, ...condition })),
    consumedConditions: consumed,
    equity: 0,
    risk: [],
  };
  state.equity =
    state.cash +
    state.positions.reduce((sum, position) => sum + position.shares * position.markPrice, 0) +
    state.futures.equity;

  return { state, trades: [...cash.trades, ...futures.trades], cashTrace };
}

export function applyActualAccountDay(
  input: AccountDayInput,
  fills: Array<{
    intent: SignalItem | FutureSignalItem;
    fill: SignalFillInput;
  }>,
): SignalAccounts {
  const { data, date, cost } = input;
  const state = structuredClone(input.prior);
  state.date = date;
  state.risk = [];
  state.conditions = input.conditions ?? state.conditions;
  for (const { intent, fill } of fills) {
    if (intent.assetType === 'future') {
      const contract = data
        .snapshotFutures(date)
        .contracts.find((row) => row.tsCode === fill.actualCode);
      if (!contract || contract.listDate > date || contract.delistDate < date) {
        throw new SignalsError('execution_unavailable');
      }
      const index = state.futures.positions.findIndex(
        (row) => row.code === intent.code && row.actualCode === fill.actualCode,
      );
      const position = state.futures.positions[index] ?? null;
      const delta = (fill.action === 'buy' ? 1 : -1) * fill.quantity;
      if (
        !Number.isInteger(fill.quantity) ||
        (fill.effect === 'close' &&
          (!position ||
            position.contracts * delta >= 0 ||
            Math.abs(delta) > Math.abs(position.contracts))) ||
        (fill.effect === 'open' && position && position.contracts * delta < 0) ||
        state.futures.positions.some(
          (row) =>
            row.actualCode === fill.actualCode &&
            row.code !== intent.code &&
            row.contracts * delta < 0,
        )
      ) {
        throw new SignalsError('execution_shares_invalid');
      }
      const applied = applyFutureFill({
        position,
        code: intent.code,
        actualCode: fill.actualCode,
        delta,
        price: fill.price,
        multiplier: contract.multiplier,
        fee: fill.fee,
        marginRate: normalizeFutureMargin(
          data.futureMarginRate(fill.actualCode, date, delta > 0 ? 'long' : 'short'),
          cost.futureMarginRate,
        ),
      });
      state.futures.equity += applied.equityChange;
      if (index >= 0) {
        state.futures.positions.splice(index, 1);
      }
      if (applied.position) {
        state.futures.positions.push(applied.position);
      }
    } else {
      if (
        fill.actualCode !== intent.code ||
        (fill.action === 'buy' ? fill.effect !== 'open' : fill.effect !== 'close')
      ) {
        throw new SignalsError('execution_unavailable');
      }
      const adj = data.adjustmentFactorOn(intent.code, date);
      if (!adj) {
        throw new SignalsError('data_not_ready', { params: { date } });
      }
      const quantity = fill.quantity / adj;
      const position = state.positions.find((row) => row.code === intent.code);
      if (fill.action === 'sell') {
        const frozen = position && position.frozenUntil > date ? position.frozenShares : 0;
        if (!position || quantity > position.shares - frozen + 1e-9) {
          throw new SignalsError('execution_shares_invalid');
        }
        position.shares -= quantity;
        state.cash += fill.quantity * fill.price - fill.fee;
      } else {
        const existing = position ?? {
          code: intent.code,
          shares: 0,
          avgCost: 0,
          frozenUntil: date,
          frozenShares: 0,
          markPrice: fill.price * adj,
          adjustmentFactor: adj,
          assetType: intent.assetType,
        };
        existing.avgCost =
          (existing.avgCost * existing.shares + fill.quantity * fill.price + fill.fee) /
          (existing.shares + quantity);
        const sameDay = data.supportsSameDayTurnover(intent.code);
        const frozen = existing.frozenUntil > date ? existing.frozenShares : 0;
        existing.shares += quantity;
        existing.frozenUntil = sameDay ? date : (data.nextDay(date) ?? date);
        existing.frozenShares = sameDay ? 0 : frozen + quantity;
        state.cash -= fill.quantity * fill.price + fill.fee;
        if (!position) {
          state.positions.push(existing);
        }
      }
      if (intent.source === 'conditional') {
        const matching = state.conditions.filter(
          (row) => intent.conditionId === `${row.key}:${row.placedDate}`,
        );
        state.consumedConditions.push(...matching.map((row) => `${row.key}:${row.placedDate}`));
      }
    }
  }
  state.positions = state.positions
    .filter((row) => row.shares > 1e-9)
    .map((row) => ({
      ...row,
      markPrice: data.adjustedCloseAsOf(row.code, date) ?? row.markPrice,
      adjustmentFactor: data.adjustmentFactorAsOf(row.code, date) ?? row.adjustmentFactor,
    }));
  state.futures.positions = state.futures.positions.map((position) => {
    const contract = data
      .snapshotFutures(date)
      .contracts.find((row) => row.tsCode === position.actualCode);
    if (contract && contract.delistDate < date) {
      throw new SignalsError('unresolved_expiry', { params: { code: position.actualCode, date } });
    }
    const bar = data.futureActualBar(position.actualCode, date);
    if (!bar?.settle) {
      throw new SignalsError('data_not_ready', {
        params: { date },
        details: { actualCode: position.actualCode },
      });
    }
    const rate = normalizeFutureMargin(
      data.futureMarginRate(position.actualCode, date, position.contracts >= 0 ? 'long' : 'short'),
      cost.futureMarginRate,
    );
    const settled = settleFuturePosition(position, bar.settle, rate);
    state.futures.equity += settled.equityChange;
    return settled.position;
  });
  state.futures.margin = state.futures.positions.reduce(
    (sum, position) => sum + position.margin,
    0,
  );
  state.futures.availableCash = state.futures.equity - state.futures.margin;
  if (state.futures.availableCash < -1e-6) {
    state.risk.push('margin_call');
  }
  if (state.cash < -1e-6) {
    state.risk.push('negative_cash');
  }
  state.equity =
    state.cash +
    state.positions.reduce((sum, position) => sum + position.shares * position.markPrice, 0) +
    state.futures.equity;

  return state;
}

function assertFutureInputs(
  input: AccountDayInput,
  positions: Iterable<SignalAccounts['futures']['positions'][number]>,
) {
  const codes = new Set([...positions].map((position) => position.actualCode));
  for (const intent of input.intents) {
    if (intent.assetType !== 'future') {
      continue;
    }
    if (intent.intent.kind === 'contracts' && intent.intent.value === 0) {
      continue;
    }
    const actualCode = input.data.futureExecutionCode(intent.code, input.previousDate, input.date);
    if (!actualCode) {
      throw new SignalsError('data_not_ready', {
        params: { date: input.date },
        details: { code: intent.code },
      });
    }
    codes.add(actualCode);
  }
  for (const code of codes) {
    const bar = input.data.futureActualBar(code, input.date);
    if (!bar?.open || !bar.settle) {
      throw new SignalsError('data_not_ready', { params: { date: input.date }, details: { code } });
    }
  }
}
