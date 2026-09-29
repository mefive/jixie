import { cashFinalStateView } from '#backtesting/result.js';
import { futureMarketSchema } from '#market/futures/snapshot.js';
import type { BacktestingFinalState } from '#backtesting/result.js';
import type { CostModel } from '#backtesting/cost.js';
import {
  normalizeFutureMargin,
  resolveFutureLegs,
  resolveFutureTarget,
} from '#backtesting/futures-accounting.js';
import type { EngineData } from '#backtesting/data/engine-data.js';
import type { FutureSignalItem, SignalAccounts, SignalFutureIntent } from '@jixie/shared';
import { createReplayData } from '../accounting/futures-market.js';
import { SignalsError } from '../errors.js';

export function projectSignalAccounts(snapshot: BacktestingFinalState): SignalAccounts {
  const state = cashFinalStateView(snapshot);
  const futures = state.futureAccount ?? { equity: 0, margin: 0, availableCash: 0, positions: [] };
  return {
    version: 2,
    date: state.tradeDate,
    cash: state.cash,
    positions: [...state.positions].map(([code, position]) => {
      const market = state.market.get(code);
      if (!market?.adjustedClose || !market.adjustmentFactor) {
        throw new SignalsError('data_not_ready', { params: { date: state.tradeDate } });
      }
      return {
        code,
        ...position,
        frozenShares: position.frozenShares ?? position.shares,
        markPrice: market.adjustedClose,
        adjustmentFactor: market.adjustmentFactor,
        assetType: market.assetType,
      };
    }),
    futures: structuredClone(futures),
    equity: state.equity + futures.equity,
    conditions: [...state.conditionalOrders].map(([key, condition]) => ({ key, ...condition })),
    consumedConditions: [],
    risk: [],
  };
}

export async function projectFutureSignals(
  state: BacktestingFinalState,
  execDate: string,
  cost: CostModel,
): Promise<FutureSignalItem[]> {
  const market = state.futureMarket ?? { contracts: [], daily: [], mappings: [], settlements: [] };
  const data = await createReplayData({
    date: state.tradeDate,
    previousDate: state.tradeDate,
    nextDate: execDate,
    codes: [],
    etfs: [],
    bars: { px: [], adj: [], limits: [], turnoverRatesF: [] },
    futures: futureMarketSchema.parse(market),
  });
  const accounts = projectSignalAccounts(state);
  const orders = new Map(
    (state.futureOrders ?? []).map((order) => [order.code, order.intent as SignalFutureIntent]),
  );
  for (const position of accounts.futures.positions) {
    if (
      !orders.has(position.code) &&
      data.futureExecutionCode(position.code, state.tradeDate, execDate) !== position.actualCode
    ) {
      orders.set(position.code, { kind: 'roll', value: 0 });
    }
  }

  return [...orders].map(([code, intent]) =>
    futureSignalReference({
      code,
      intent,
      accounts,
      data,
      decisionDate: state.tradeDate,
      execDate,
      cost,
    }),
  );
}

export function futureSignalReference(input: {
  code: string;
  intent: SignalFutureIntent;
  accounts: SignalAccounts;
  data: EngineData;
  decisionDate: string;
  execDate: string;
  cost: CostModel;
}): FutureSignalItem {
  const { code, intent, accounts, data, decisionDate, execDate, cost } = input;
  const currentPositions = accounts.futures.positions.filter((position) => position.code === code);
  const exiting = intent.kind === 'contracts' && intent.value === 0;
  const actualCode =
    exiting && currentPositions[0]
      ? currentPositions[0].actualCode
      : data.futureExecutionCode(code, decisionDate, execDate);
  const bar = actualCode ? data.futureActualBar(actualCode, decisionDate) : null;
  const mapping = data
    .snapshotFutures(decisionDate)
    .mappings.find((row) => row.continuousCode === code);
  if (
    !actualCode ||
    !bar?.close ||
    (!exiting && /^(IF|IH|IC|IM)\.CFX$/.test(code) && mapping?.tradeDate !== decisionDate)
  ) {
    throw new SignalsError('data_not_ready', { params: { date: decisionDate }, details: { code } });
  }
  const current = currentPositions.reduce((sum, position) => sum + position.contracts, 0);
  const target = resolveFutureTarget({
    intent,
    current,
    price: bar.close,
    multiplier: bar.multiplier,
    cashExposure: accounts.positions.reduce(
      (sum, position) => sum + position.shares * position.markPrice,
      0,
    ),
  });
  const source = data.futureMarginRate(actualCode, decisionDate, target >= 0 ? 'long' : 'short');
  const rate = normalizeFutureMargin(source, cost.futureMarginRate);

  return {
    assetType: 'future',
    code,
    name: code,
    intent,
    decisionDate,
    execDate,
    actualCode,
    mappingDate: mapping?.tradeDate ?? decisionDate,
    referencePrice: bar.close,
    multiplier: bar.multiplier,
    referenceTargetContracts: target,
    referenceNotional: target * bar.close * bar.multiplier,
    referenceMargin: Math.abs(target) * bar.close * bar.multiplier * rate,
    marginSource: source != null && source > 0 && source <= 100 ? 'data' : 'config',
    referenceLegs: resolveFutureLegs({
      code,
      actualCode,
      multiplier: bar.multiplier,
      target,
      positions: currentPositions,
    }),
  };
}
