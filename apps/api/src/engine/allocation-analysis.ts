import type {
  AllocationAnalysis,
  AllocationAssetClass,
  AllocationCorrelationAnalysis,
  AllocationCorrelationWindow,
  AllocationDriftEvent,
  AllocationRateRegimeAnalysis,
  AllocationRateRegimeKey,
  AllocationWeightPoint,
  MultiAssetClass,
} from '@jixie/shared';
import { daysBetween } from '../lib/date.js';
import type { CustomFactorModule } from './custom-factor.js';
import type { GovernmentYieldObservation } from './data.js';
import type { Position, TradeRecord } from './types.js';

const CASH = 'CASH';
const CORRELATION_WINDOWS = [60, 120] as const;
const MINIMUM_CORRELATION_COVERAGE = 2 / 3;
const RATE_DIRECTION_LOOKBACK = 60;
const CURVE_MEDIAN_LOOKBACK = 252;
const CURVE_MEDIAN_MINIMUM = 120;
const MAXIMUM_CURVE_STALENESS_DAYS = 14;
const RATE_REGIME_KEYS: AllocationRateRegimeKey[] = [
  'rates_rising_curve_steep',
  'rates_rising_curve_flat',
  'rates_falling_curve_steep',
  'rates_falling_curve_flat',
];

export interface AllocationRateRegimeObservation {
  asOfDate: string;
  state: AllocationRateRegimeKey;
  tenYearYieldPct: number;
  tenYearChangeBp: number;
  curveSlopeBp: number;
  curveMedianBp: number;
}

interface AssetAccumulator {
  assetId: string;
  assetClass: AllocationAssetClass;
  weightSum: number;
  grossPnl: number;
  fees: number;
  slippage: number;
  dailyNetReturns: number[];
}

/** The approved Panel research universe is the authoritative exposure taxonomy for a run. */
export function allocationAssetClasses(
  modules: CustomFactorModule[] | undefined,
): Map<string, MultiAssetClass> {
  const classes = new Map<string, MultiAssetClass>();
  for (const module of modules ?? []) {
    for (const asset of module.assetUniverse ?? module.panelComposite?.assetUniverse ?? []) {
      const existing = classes.get(asset.assetId);
      if (existing && existing !== asset.assetClass) {
        throw new Error(`conflicting asset classes for ${asset.assetId}`);
      }
      classes.set(asset.assetId, asset.assetClass);
    }
  }
  return classes;
}

/** Produces exact daily component P&L and compact allocation diagnostics inside the engine. */
export class AllocationAnalysisTracker {
  private readonly assets = new Map<string, AssetAccumulator>();
  private readonly previousShares = new Map<string, number>();
  private readonly previousClose = new Map<string, number>();
  private readonly previousExactClose = new Map<string, number>();
  private readonly portfolioReturns: number[] = [];
  private readonly dates: string[] = [];
  private readonly classMarketReturns = new Map<AllocationAssetClass, Array<number | null>>();
  private readonly rateRegimeObservations: Array<AllocationRateRegimeObservation | null> = [];
  private readonly drift: AllocationDriftEvent[] = [];
  private previousEquity: number;
  private observations = 0;

  constructor(
    private readonly initialCash: number,
    private readonly assetClasses: Map<string, MultiAssetClass>,
  ) {
    this.previousEquity = initialCash;
    for (const [assetId, assetClass] of assetClasses) {
      this.assets.set(assetId, emptyAsset(assetId, assetClass));
      if (!this.classMarketReturns.has(assetClass)) {
        this.classMarketReturns.set(assetClass, []);
      }
    }
  }

  captureDay(args: {
    date: string;
    value: number;
    positions: ReadonlyMap<string, Position>;
    closeOf: (assetId: string) => number | null;
    exactCloseOf: (assetId: string) => number | null;
    trades: TradeRecord[];
    rateRegime?: AllocationRateRegimeObservation | null;
  }): void {
    this.captureClassMarketReturns(args.date, args.exactCloseOf);
    this.rateRegimeObservations.push(args.rateRegime ?? null);
    const codes = new Set<string>([
      ...this.assets.keys(),
      ...this.previousShares.keys(),
      ...args.positions.keys(),
      ...args.trades.map((trade) => trade.code),
    ]);
    for (const code of codes) {
      this.ensureAsset(code);
    }

    const netPnlByAsset = new Map<string, number>();
    for (const code of codes) {
      const accumulator = this.assets.get(code)!;
      const close = args.closeOf(code) ?? this.previousClose.get(code) ?? null;
      const previousClose = this.previousClose.get(code);
      const previousShares = this.previousShares.get(code) ?? 0;
      let grossPnl =
        close != null && previousClose != null ? previousShares * (close - previousClose) : 0;
      let fees = 0;
      let slippage = 0;

      for (const trade of args.trades) {
        if (trade.code !== code || trade.assetType === 'future') {
          continue;
        }
        const signedShares = trade.side === 'buy' ? trade.shares : -trade.shares;
        const tradeSlippage = trade.slippageCost ?? 0;
        if (close != null) {
          // Add slippage back here so gross P&L is measured at the unslipped execution price.
          grossPnl += signedShares * (close - trade.price) + tradeSlippage;
        }
        fees += trade.fee;
        slippage += tradeSlippage;
      }

      accumulator.grossPnl += grossPnl;
      accumulator.fees += fees;
      accumulator.slippage += slippage;
      const netPnl = grossPnl - fees - slippage;
      netPnlByAsset.set(code, netPnl);

      const position = args.positions.get(code);
      if (position && close != null && args.value > 0) {
        accumulator.weightSum += (position.shares * close) / args.value;
      }
      if (close != null) {
        this.previousClose.set(code, close);
      }
    }

    const denominator = this.previousEquity > 0 ? this.previousEquity : this.initialCash;
    this.portfolioReturns.push(denominator > 0 ? args.value / denominator - 1 : 0);
    for (const accumulator of this.assets.values()) {
      accumulator.dailyNetReturns.push((netPnlByAsset.get(accumulator.assetId) ?? 0) / denominator);
    }
    this.previousShares.clear();
    for (const [code, position] of args.positions) {
      this.previousShares.set(code, position.shares);
    }
    this.previousEquity = args.value;
    this.observations += 1;
  }

  weights(
    cash: number,
    positions: ReadonlyMap<string, Position>,
    priceOf: (assetId: string) => number | null,
  ): Map<string, number> {
    const values = new Map<string, number>([[CASH, cash]]);
    let equity = cash;
    for (const [assetId, position] of positions) {
      const value = position.shares * (priceOf(assetId) ?? 0);
      values.set(assetId, value);
      equity += value;
    }
    return new Map(
      [...values].map(([assetId, value]) => [assetId, equity > 0 ? value / equity : 0]),
    );
  }

  captureRebalance(args: {
    decisionDate: string;
    executionDate: string;
    targets: ReadonlyMap<string, number>;
    preTrade: ReadonlyMap<string, number>;
    postTrade: ReadonlyMap<string, number>;
  }): void {
    const target = new Map(args.targets);
    target.set(CASH, 1 - [...args.targets.values()].reduce((sum, value) => sum + value, 0));
    const assetIds = [
      ...new Set([...target.keys(), ...args.preTrade.keys(), ...args.postTrade.keys()]),
    ]
      .filter((assetId) => assetId !== CASH)
      .sort();
    assetIds.push(CASH);
    this.drift.push({
      decisionDate: args.decisionDate,
      executionDate: args.executionDate,
      target: this.weightPoints(assetIds, target),
      preTrade: this.weightPoints(assetIds, args.preTrade),
      postTrade: this.weightPoints(assetIds, args.postTrade),
      preTradeDistance: weightDistance(assetIds, target, args.preTrade),
      postTradeDistance: weightDistance(assetIds, target, args.postTrade),
      maxPostTradeDeviation: Math.max(
        0,
        ...assetIds.map((assetId) =>
          Math.abs((target.get(assetId) ?? 0) - (args.postTrade.get(assetId) ?? 0)),
        ),
      ),
    });
  }

  finish(finalValue: number): AllocationAnalysis {
    const portfolioPnl = finalValue - this.initialCash;
    const totalFees = [...this.assets.values()].reduce((sum, asset) => sum + asset.fees, 0);
    const totalSlippage = [...this.assets.values()].reduce((sum, asset) => sum + asset.slippage, 0);
    const rawRisk = new Map<string, number | null>();
    const portfolioVariance = centeredSumOfSquares(this.portfolioReturns);
    for (const asset of this.assets.values()) {
      rawRisk.set(
        asset.assetId,
        portfolioVariance > 0
          ? centeredCrossProduct(asset.dailyNetReturns, this.portfolioReturns) / portfolioVariance
          : null,
      );
    }
    const rawRiskTotal = [...rawRisk.values()].reduce<number>(
      (sum, value) => sum + (value ?? 0),
      0,
    );
    const riskOf = (assetId: string): number | null => {
      const value = rawRisk.get(assetId);
      return value == null || Math.abs(rawRiskTotal) < 1e-12 ? null : value / rawRiskTotal;
    };

    const assets = [...this.assets.values()]
      .map((asset) => {
        const costs = asset.fees + asset.slippage;
        const netPnl = asset.grossPnl - costs;
        return {
          assetId: asset.assetId,
          assetClass: asset.assetClass,
          averageWeight: this.observations > 0 ? asset.weightSum / this.observations : 0,
          grossPnl: asset.grossPnl,
          costs,
          netPnl,
          returnContribution: this.initialCash > 0 ? netPnl / this.initialCash : 0,
          riskContribution: riskOf(asset.assetId),
        };
      })
      .filter(
        (asset) =>
          this.assetClasses.has(asset.assetId) ||
          Math.abs(asset.netPnl) > 1e-8 ||
          asset.averageWeight > 1e-8,
      )
      .sort((left, right) => Math.abs(right.netPnl) - Math.abs(left.netPnl));
    const assetClasses = [...new Set(assets.map((asset) => asset.assetClass))]
      .map((assetClass) => {
        const rows = assets.filter((asset) => asset.assetClass === assetClass);
        return {
          assetClass,
          averageWeight: rows.reduce((sum, row) => sum + row.averageWeight, 0),
          grossPnl: rows.reduce((sum, row) => sum + row.grossPnl, 0),
          costs: rows.reduce((sum, row) => sum + row.costs, 0),
          netPnl: rows.reduce((sum, row) => sum + row.netPnl, 0),
          returnContribution: rows.reduce((sum, row) => sum + row.returnContribution, 0),
          riskContribution: rows.some((row) => row.riskContribution != null)
            ? rows.reduce((sum, row) => sum + (row.riskContribution ?? 0), 0)
            : null,
        };
      })
      .sort((left, right) => Math.abs(right.netPnl) - Math.abs(left.netPnl));
    const attributedNetPnl = assets.reduce((sum, asset) => sum + asset.netPnl, 0);
    const residual = portfolioPnl - attributedNetPnl;
    const tolerance = Math.max(0.01, Math.abs(portfolioPnl) * 1e-8);

    return {
      version: 1,
      methodology: 'daily_component_pnl',
      riskMethodology: 'component_covariance',
      observations: this.observations,
      reconciliation: {
        portfolioPnl,
        attributedNetPnl,
        residual,
        tolerance,
        reconciled: Math.abs(residual) <= tolerance,
      },
      costs: { fees: totalFees, slippage: totalSlippage, total: totalFees + totalSlippage },
      assets,
      assetClasses,
      drift: this.drift,
      correlations: this.buildCorrelations(),
      rateRegimes: this.buildRateRegimes(),
    };
  }

  private captureClassMarketReturns(
    date: string,
    exactCloseOf: (assetId: string) => number | null,
  ): void {
    const currentExactClose = new Map<string, number>();
    const returnsByClass = new Map<AllocationAssetClass, number[]>();
    for (const [assetId, assetClass] of this.assetClasses) {
      const close = exactCloseOf(assetId);
      if (close == null || !Number.isFinite(close) || close <= 0) {
        continue;
      }
      currentExactClose.set(assetId, close);
      const previous = this.previousExactClose.get(assetId);
      if (previous == null || previous <= 0) {
        continue;
      }
      const rows = returnsByClass.get(assetClass) ?? [];
      rows.push(close / previous - 1);
      returnsByClass.set(assetClass, rows);
    }
    for (const [assetClass, series] of this.classMarketReturns) {
      const returns = returnsByClass.get(assetClass) ?? [];
      series.push(
        returns.length > 0 ? returns.reduce((sum, value) => sum + value, 0) / returns.length : null,
      );
    }
    this.previousExactClose.clear();
    for (const [assetId, close] of currentExactClose) {
      this.previousExactClose.set(assetId, close);
    }
    this.dates.push(date);
  }

  private buildCorrelations(): AllocationCorrelationAnalysis {
    return {
      methodology: 'equal_weight_asset_class_returns',
      sampling: 'month_end',
      minimumCoverage: MINIMUM_CORRELATION_COVERAGE,
      windows: CORRELATION_WINDOWS.map((window) => this.buildCorrelationWindow(window)),
    };
  }

  private buildCorrelationWindow(
    window: (typeof CORRELATION_WINDOWS)[number],
  ): AllocationCorrelationWindow {
    const assetClasses = [...this.classMarketReturns.keys()];
    const minimumObservations = Math.ceil(window * MINIMUM_CORRELATION_COVERAGE);
    const endIndex = this.dates.length - 1;
    const latest = assetClasses.map((left) =>
      assetClasses.map(
        (right) =>
          correlationAt(
            this.classMarketReturns.get(left)!,
            this.classMarketReturns.get(right)!,
            endIndex,
            window,
            minimumObservations,
          ).value,
      ),
    );
    const latestObservations = assetClasses.map((left) =>
      assetClasses.map(
        (right) =>
          correlationAt(
            this.classMarketReturns.get(left)!,
            this.classMarketReturns.get(right)!,
            endIndex,
            window,
            minimumObservations,
          ).observations,
      ),
    );
    const monthEnds = this.dates
      .map((date, index) => ({ date, index }))
      .filter(
        ({ date, index }) =>
          index === this.dates.length - 1 || this.dates[index + 1].slice(0, 6) !== date.slice(0, 6),
      )
      .filter(({ index }) => index + 1 >= window);
    const series = assetClasses.flatMap((left, leftIndex) =>
      assetClasses.slice(leftIndex + 1).map((right) => ({
        left,
        right,
        points: monthEnds.map(({ date, index }) => ({
          date,
          ...correlationAt(
            this.classMarketReturns.get(left)!,
            this.classMarketReturns.get(right)!,
            index,
            window,
            minimumObservations,
          ),
        })),
      })),
    );
    return {
      window,
      asOfDate: this.dates.at(-1) ?? '',
      minimumObservations,
      assetClasses,
      latest,
      latestObservations,
      series,
    };
  }

  private buildRateRegimes(): AllocationRateRegimeAnalysis | undefined {
    const classifiedDays = this.rateRegimeObservations.filter(Boolean).length;
    if (classifiedDays === 0) {
      return undefined;
    }

    const episodes = new Map<AllocationRateRegimeKey, number>();
    let previousState: AllocationRateRegimeKey | null = null;
    for (const observation of this.rateRegimeObservations) {
      if (!observation) {
        previousState = null;
        continue;
      }
      if (observation.state !== previousState) {
        episodes.set(observation.state, (episodes.get(observation.state) ?? 0) + 1);
      }
      previousState = observation.state;
    }

    const states = RATE_REGIME_KEYS.map((key) => {
      const stateIndices = this.rateRegimeObservations
        .map((observation, index) => (observation?.state === key ? index : -1))
        .filter((index) => index >= 0);
      const stateEpisodes = episodes.get(key) ?? 0;
      return {
        key,
        observations: stateIndices.length,
        episodes: stateEpisodes,
        averageDuration: stateEpisodes > 0 ? stateIndices.length / stateEpisodes : 0,
        assetClasses: [...this.classMarketReturns].map(([assetClass, returns]) => {
          const values = stateIndices
            .map((index) => returns[index])
            .filter((value): value is number => value != null && Number.isFinite(value));
          const average = mean(values);
          return {
            assetClass,
            observations: values.length,
            meanDailyReturn: average,
            annualizedMeanReturn: average * 252,
            annualizedVolatility: sampleStandardDeviation(values) * Math.sqrt(252),
            positiveDayRate:
              values.length > 0 ? values.filter((value) => value > 0).length / values.length : 0,
            maximumEpisodeDrawdown: maximumEpisodeDrawdown(
              returns,
              this.rateRegimeObservations,
              key,
            ),
          };
        }),
      };
    }).filter((state) => state.observations > 0);

    return {
      methodology: 'cgb_10y_direction_and_10y_2y_relative_slope',
      pointInTime: 'available_date',
      directionLookbackObservations: RATE_DIRECTION_LOOKBACK,
      curveMedianLookbackObservations: CURVE_MEDIAN_LOOKBACK,
      curveMedianMinimumObservations: CURVE_MEDIAN_MINIMUM,
      classifiedDays,
      totalDays: this.dates.length,
      latest: [...this.rateRegimeObservations].reverse().find(Boolean) ?? null,
      states,
    };
  }

  private ensureAsset(assetId: string): void {
    if (this.assets.has(assetId)) {
      return;
    }
    const asset = emptyAsset(assetId, this.assetClasses.get(assetId) ?? 'other');
    asset.dailyNetReturns = Array(this.observations).fill(0);
    this.assets.set(assetId, asset);
  }

  private weightPoints(
    assetIds: string[],
    weights: ReadonlyMap<string, number>,
  ): AllocationWeightPoint[] {
    return assetIds.map((assetId) => ({
      assetId,
      assetClass: assetId === CASH ? 'other' : (this.assetClasses.get(assetId) ?? 'other'),
      weight: weights.get(assetId) ?? 0,
    }));
  }
}

/** Classifies a transparent rate environment using only curve points available by `asOfDate`. */
export function classifyAllocationRateRegime(
  asOfDate: string,
  tenYearHistory: GovernmentYieldObservation[],
  twoYearHistory: GovernmentYieldObservation[],
): AllocationRateRegimeObservation | null {
  if (tenYearHistory.length <= RATE_DIRECTION_LOOKBACK) {
    return null;
  }
  const latest = tenYearHistory.at(-1)!;
  if (daysBetween(latest.availableDate, asOfDate) > MAXIMUM_CURVE_STALENESS_DAYS) {
    return null;
  }
  const previous = tenYearHistory.at(-RATE_DIRECTION_LOOKBACK - 1)!;
  const twoYearByDate = new Map(
    twoYearHistory.map((observation) => [observation.availableDate, observation.yieldPct]),
  );
  const spreads = tenYearHistory
    .slice(-CURVE_MEDIAN_LOOKBACK)
    .map((observation) => {
      const twoYearYield = twoYearByDate.get(observation.availableDate);
      return twoYearYield == null ? null : (observation.yieldPct - twoYearYield) * 100;
    })
    .filter((spread): spread is number => spread != null && Number.isFinite(spread));
  if (spreads.length < CURVE_MEDIAN_MINIMUM) {
    return null;
  }
  const twoYearYield = twoYearByDate.get(latest.availableDate);
  if (twoYearYield == null) {
    return null;
  }

  const tenYearChangeBp = (latest.yieldPct - previous.yieldPct) * 100;
  const curveSlopeBp = (latest.yieldPct - twoYearYield) * 100;
  const curveMedianBp = median(spreads);
  const direction = tenYearChangeBp >= 0 ? 'rates_rising' : 'rates_falling';
  const shape = curveSlopeBp >= curveMedianBp ? 'curve_steep' : 'curve_flat';
  return {
    asOfDate,
    state: `${direction}_${shape}`,
    tenYearYieldPct: latest.yieldPct,
    tenYearChangeBp,
    curveSlopeBp,
    curveMedianBp,
  };
}

function emptyAsset(assetId: string, assetClass: AllocationAssetClass): AssetAccumulator {
  return {
    assetId,
    assetClass,
    weightSum: 0,
    grossPnl: 0,
    fees: 0,
    slippage: 0,
    dailyNetReturns: [],
  };
}

function weightDistance(
  assetIds: string[],
  target: ReadonlyMap<string, number>,
  actual: ReadonlyMap<string, number>,
): number {
  return (
    assetIds.reduce(
      (sum, assetId) => sum + Math.abs((target.get(assetId) ?? 0) - (actual.get(assetId) ?? 0)),
      0,
    ) / 2
  );
}

function centeredSumOfSquares(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - average) ** 2, 0);
}

function centeredCrossProduct(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) {
    return 0;
  }
  const leftAverage = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightAverage = right.reduce((sum, value) => sum + value, 0) / right.length;
  return left.reduce(
    (sum, value, index) => sum + (value - leftAverage) * (right[index] - rightAverage),
    0,
  );
}

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function sampleStandardDeviation(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const average = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function median(values: number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle];
}

function maximumEpisodeDrawdown(
  returns: Array<number | null>,
  observations: Array<AllocationRateRegimeObservation | null>,
  state: AllocationRateRegimeKey,
): number {
  let maximumDrawdown = 0;
  let wealth = 1;
  let peak = 1;
  let active = false;
  for (let index = 0; index < observations.length; index++) {
    if (observations[index]?.state !== state) {
      wealth = 1;
      peak = 1;
      active = false;
      continue;
    }
    const dailyReturn = returns[index];
    if (dailyReturn == null || !Number.isFinite(dailyReturn)) {
      continue;
    }
    if (!active) {
      active = true;
      wealth = 1;
      peak = 1;
    }
    wealth *= 1 + dailyReturn;
    peak = Math.max(peak, wealth);
    maximumDrawdown = Math.min(maximumDrawdown, peak > 0 ? wealth / peak - 1 : 0);
  }
  return maximumDrawdown;
}

function correlationAt(
  left: Array<number | null>,
  right: Array<number | null>,
  endIndex: number,
  window: number,
  minimumObservations: number,
): { value: number | null; observations: number } {
  if (endIndex < 0 || endIndex + 1 < window) {
    return { value: null, observations: 0 };
  }
  const pairs: Array<[number, number]> = [];
  const startIndex = endIndex - window + 1;
  for (let index = startIndex; index <= endIndex; index++) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (leftValue != null && rightValue != null) {
      pairs.push([leftValue, rightValue]);
    }
  }
  if (pairs.length < minimumObservations) {
    return { value: null, observations: pairs.length };
  }
  const leftAverage = pairs.reduce((sum, pair) => sum + pair[0], 0) / pairs.length;
  const rightAverage = pairs.reduce((sum, pair) => sum + pair[1], 0) / pairs.length;
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (const [leftValue, rightValue] of pairs) {
    const leftCentered = leftValue - leftAverage;
    const rightCentered = rightValue - rightAverage;
    covariance += leftCentered * rightCentered;
    leftVariance += leftCentered ** 2;
    rightVariance += rightCentered ** 2;
  }
  const denominator = Math.sqrt(leftVariance * rightVariance);
  return {
    value: denominator > 0 ? covariance / denominator : null,
    observations: pairs.length,
  };
}
