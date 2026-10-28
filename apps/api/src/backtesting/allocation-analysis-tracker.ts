import type {
  AllocationAnalysis,
  AllocationAssetClass,
  AllocationCorrelationAnalysis,
  AllocationCorrelationWindow,
  AllocationDriftEvent,
  AllocationWeightPoint,
  MultiAssetClass,
} from '@jixie/shared';
import type { Position } from './cash-portfolio.js';
import type { TradeRecord } from './trade.js';

const CASH = 'CASH';
const CORRELATION_WINDOWS = [60, 120] as const;
const MINIMUM_CORRELATION_COVERAGE = 2 / 3;

/**
 * 在逐日归因期间累计单资产敞口、盈亏与成本，最终转换为报告中的资产贡献。
 *
 * Accumulate one asset's exposure, profit and costs before producing allocation contribution rows.
 */
interface AssetAccumulator {
  assetId: string;
  assetClass: AllocationAssetClass;
  weightSum: number;
  grossPnl: number;
  fees: number;
  slippage: number;
  dailyNetReturns: number[];
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
  private readonly drift: AllocationDriftEvent[] = [];
  private previousEquity: number;
  private observations = 0;
  private readonly nav: Array<{ date: string; value: number }> = [];

  /**
   * 按归因范围初始化资产及类别累积器，供逐日捕获。
   *
   * Initialize asset and class accumulators for daily allocation capture.
   */
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

  /**
   * 从当日账户快照累计资产净值、风险敞口和收益贡献，为最终组合归因准备时间序列。
   *
   * Accumulate daily account values, exposures and contributions for the final allocation analysis.
   */
  captureDay(args: {
    date: string;
    value: number;
    positions: ReadonlyMap<string, Position>;
    closeOf: (assetId: string) => number | null;
    exactCloseOf: (assetId: string) => number | null;
    trades: TradeRecord[];
  }): void {
    this.nav.push({ date: args.date, value: args.value });
    this.captureClassMarketReturns(args.date, args.exactCloseOf);
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
        if (trade.code !== code) {
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
      accumulator.dailyNetReturns.push(
        denominator > 0 ? (netPnlByAsset.get(accumulator.assetId) ?? 0) / denominator : 0,
      );
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

  /**
   * 记录调仓前后权重及成交成本，用于解释配置变化和换手来源。
   *
   * Capture pre- and post-rebalance weights and costs to explain allocation changes and turnover.
   */
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

  /**
   * 将逐日累计数据整理为资产贡献、相关性、利率环境和调仓分析结果。
   *
   * Finalize accumulated daily observations into contribution, correlation, rate-regime and rebalance analyses.
   */
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
          (this.initialCash > 0 && this.assetClasses.has(asset.assetId)) ||
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
      scope: 'cash_account',
      nav: this.nav.map((point) => ({ ...point })),
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
      correlations:
        this.initialCash > 0 && this.classMarketReturns.size > 0
          ? this.buildCorrelations()
          : undefined,
    };
  }

  /**
   * 按资产类别累计可用的市场收益序列，供跨类别相关性和环境分析使用。
   *
   * Collect available market returns by asset class for correlation and regime analysis.
   */
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

  /**
   * 对齐共同日期上的资产收益，生成指定窗口的相关性输入与结果。
   *
   * Align asset returns on common dates and build the requested correlation window.
   */
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

/**
 * 读取两条已对齐收益序列的相关性；不可计算时保留缺失语义。
 *
 * Read pairwise correlation for aligned return series while preserving unavailable results.
 */
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
