import { serializeFinalState } from './result.js';
import { DEFAULT_LOCALE, isComputedFactorKey } from '@jixie/shared';
import { t } from '#i18n/messages.js';
import { day } from '#date';
import { CSI_300_TOTAL_RETURN_INDEX_CODE } from '#market/registry/index-presets.js';
import { EngineData } from './data/engine-data.js';
import { FactorEvaluator } from './factors/factor-evaluator.js';
import { describeFactors } from './factors/description.js';
import { CashPortfolio } from './cash-portfolio.js';
import { FuturesPortfolio } from './futures-portfolio.js';
import { OrderBook } from './order-book.js';
import { BacktestingContext } from './backtesting-context.js';
import { DEFAULT_COST } from './cost.js';
import type { BacktestingConfig } from './contract.js';
import type { BacktestingResult, BacktestingFinalState, SleeveNavPoint } from './result.js';
import { summarizePerformance } from './performance.js';
import {
  AllocationAnalysisTracker,
  classifyAllocationRateRegime,
} from './allocation-analysis-tracker.js';

const BENCHMARK = CSI_300_TOTAL_RETURN_INDEX_CODE;

/** One event-driven run: execute queued orders, mark the close, then ask for the next decision. */
export class BacktestingEngine {
  private started = false;
  private completed = false;

  private readonly cost;
  private readonly locale;
  private readonly log;
  private readonly cnyNumberFormat;

  private factorDescription = describeFactors([]);

  private engineData!: EngineData;
  private cashPortfolio!: CashPortfolio;
  private futuresPortfolio!: FuturesPortfolio;
  private orderBook!: OrderBook;
  private factorEvaluator: FactorEvaluator | null = null;
  private allocationTracker!: AllocationAnalysisTracker;

  private lastLoggedYear = '';
  private capturedTrades = 0;
  private readonly nav: { date: string; value: number }[] = [];
  private readonly sleeveNav: SleeveNavPoint[] = [];
  private readonly factorObservations = new Map<string, Map<string, number | null>>();

  constructor(private readonly config: BacktestingConfig) {
    this.cost = { ...DEFAULT_COST, ...config.cost };
    this.locale = config.locale ?? DEFAULT_LOCALE;
    this.log = config.onLog ?? (() => {});
    this.cnyNumberFormat = new Intl.NumberFormat(this.locale === 'zh' ? 'zh-CN' : 'en-US', {
      useGrouping: true,
      maximumFractionDigits: 0,
    });
  }

  /**
   * 推进完整交易日循环，按既定顺序执行订单、决策和结算，返回本次模拟结果。
   *
   * Run the simulation calendar through order execution, decisions and settlement, then collect the result.
   */
  async run(): Promise<BacktestingResult> {
    if (this.started) {
      throw new Error('BacktestingEngine requires a fresh instance');
    }
    this.started = true;

    this.validateConfig();

    await this.initialize();

    const { engineData, futuresPortfolio, orderBook } = this;
    const total = engineData.timeline.length;

    for (let index = 0; index < total; index++) {
      const date = engineData.timeline[index];
      const previousDate = engineData.timeline[index - 1];

      this.assertNoDelistedPositions(date);

      await orderBook.executeOrders(date, previousDate);

      futuresPortfolio.settle(engineData, date);

      this.recordEndOfDay(date);

      this.logProgress(index + 1, total);

      await this.runDecision(date, index === total - 1);
    }

    const result = this.collectResult();
    this.completed = true;

    return result;
  }

  /**
   * 在模拟开始前验证配置与执行范围，尽早拒绝无法正确运行的输入。
   *
   * Validate simulation configuration and supported execution requirements before initializing a run.
   */
  private validateConfig(): void {
    const { config, cost } = this;

    if (!/^\d{8}$/.test(config.start) || !/^\d{8}$/.test(config.end) || config.start > config.end) {
      throw new Error('Backtest dates must be valid YYYYMMDD values with start no later than end');
    }
    if (!Number.isFinite(config.initialCash) || config.initialCash <= 0) {
      throw new Error('Initial cash must be a positive finite number');
    }

    for (const [key, value] of Object.entries(config.strategy.params ?? {})) {
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new Error(`Strategy parameter ${key} must be finite`);
      }
    }

    for (const [key, value] of Object.entries(cost)) {
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Cost setting ${key} must be a finite non-negative number`);
      }
    }
    if (cost.futureMarginRate <= 0 || cost.futureMarginRate > 1) {
      throw new Error('Cost setting futureMarginRate must be between 0 and 1');
    }
  }

  /**
   * 预载模拟所需市场数据并恢复初始账户及订单状态，为交易日循环建立起点。
   *
   * Load required market data and initialize accounts and order state before advancing trading days.
   */
  private async initialize(): Promise<void> {
    const { config, cost, locale, log } = this;

    await this.loadFactorDescription();

    const cashWeights = this.resolveInitialCashWeights();
    const { dataRequirements, preloadCodes, assetClassByCode } = this.factorDescription;

    this.allocationTracker = new AllocationAnalysisTracker(
      config.initialCash * cashWeights.stock,
      assetClassByCode,
    );

    this.engineData = new EngineData({
      start: config.start,
      end: config.end,
      factorKeys: config.strategy.factors ?? [],
      onLog: log,
      locale,
      dataPort: config.dataPort,
      requirements: {
        ...dataRequirements,
        governmentYieldCurve:
          dataRequirements.governmentYieldCurve ||
          this.allocationTracker.requiresGovernmentYieldCurve,
      },
      preloadCodes: [...new Set([...(config.strategy.watch ?? []), ...preloadCodes])],
    });

    await this.engineData.load();

    this.initializeFactorEvaluator();

    this.cashPortfolio = new CashPortfolio(config.initialCash * cashWeights.stock, cost);
    this.futuresPortfolio = new FuturesPortfolio(config.initialCash * cashWeights.futures, cost);

    this.orderBook = new OrderBook({
      locale: this.locale,
      engineData: this.engineData,
      cashPortfolio: this.cashPortfolio,
      futuresPortfolio: this.futuresPortfolio,
      allocationTracker: this.allocationTracker,
      onRebalance: (date) => this.logRebalance(date),
      cost,
    });

    this.logStart();
  }

  /**
   * 读取已注册因子的定义与数据需求，供引擎准备依赖而不加载用户源码。
   *
   * Load registered factor descriptions and data requirements without loading user source into the engine.
   */
  private async loadFactorDescription(): Promise<void> {
    const { config, locale } = this;
    const declaredKeys = (config.strategy.factors ?? []).filter(isComputedFactorKey);

    if (!config.factorExecution) {
      if (declaredKeys.length > 0) {
        throw new Error(t(locale, 'customFactorExecutionUnavailable'));
      }

      this.factorDescription = describeFactors([]);
      return;
    }

    const description = structuredClone(await config.factorExecution.describe());
    const { definitions } = description;
    const keys = new Set(definitions.map((definition) => definition.id));

    if (keys.size !== definitions.length) {
      throw new Error('Duplicate factor definitions');
    }

    const missing = declaredKeys.filter((key) => !keys.has(key));

    if (missing.length > 0) {
      throw new Error(t(locale, 'customFactorMissing', { keys: missing.join(', ') }));
    }

    this.factorDescription = description;
  }

  /**
   * 解析初始现金资产权重，供模拟启动时建立配置对应的资产分配。
   *
   * Resolve initial cash-asset weights for the starting allocation.
   */
  private resolveInitialCashWeights(): { stock: number; futures: number } {
    const { config } = this;

    if (!config.strategy.accounts) {
      return { stock: 1, futures: 0 };
    }

    const stock = config.strategy.accounts.stock.cashWeight;
    const futures = config.strategy.accounts.futures.cashWeight;

    if (!Number.isFinite(stock) || !Number.isFinite(futures) || stock < 0 || futures < 0) {
      throw new Error('Account cash weights must be finite non-negative numbers');
    }
    if (Math.abs(stock + futures - 1) > 1e-9) {
      throw new Error('Stock and futures account cash weights must sum to 1');
    }

    return { stock, futures };
  }

  /**
   * 将已加载定义、行情与执行端口装配为会话因子求值器。
   *
   * Construct the session evaluator from prepared definitions, data and execution ports.
   */
  private initializeFactorEvaluator(): void {
    const { config, engineData, locale, log } = this;
    const { definitions } = this.factorDescription;

    if (definitions.length === 0) {
      this.factorEvaluator = null;
      return;
    }
    if (!config.factorExecution) {
      throw new Error(t(locale, 'customFactorExecutionUnavailable'));
    }

    this.factorEvaluator = new FactorEvaluator({
      definitions,
      engineData,
      executionPort: config.factorExecution,
      assetUniverse: config.strategy.watch ?? [],
      onComputeError: (key, message) => {
        log(`[factor-error] ${key}: ${message}`);
      },
      locale,
    });
  }

  /**
   * 阻止账户在官方最后上市日期之后继续持有证券。
   *
   * Reject positions carried beyond their official final listing dates.
   */
  private assertNoDelistedPositions(date: string): void {
    const { cashPortfolio: portfolio, engineData } = this;

    for (const code of portfolio.positions.keys()) {
      const delistDate = engineData.delistedBefore(code, date);

      if (delistDate) {
        throw new Error(
          `Cannot value delisted position ${code} on ${date}; final listing date was ${delistDate}`,
        );
      }
    }
  }

  /**
   * 在当日交易及结算完成后记录账户净值和归因观察，供绩效汇总使用。
   *
   * Record end-of-day account values and allocation observations after execution and settlement.
   */
  private recordEndOfDay(date: string): void {
    const { engineData, cashPortfolio, futuresPortfolio } = this;

    const stockValue = cashPortfolio.equity((code) => engineData.adjustedCloseAsOf(code, date));
    const value = stockValue + futuresPortfolio.cash;

    this.nav.push({ date, value });

    const stockGrossExposure = cashPortfolio.marketValue((code) =>
      engineData.adjustedCloseAsOf(code, date),
    );
    const futureNotional = futuresPortfolio.notional((actualCode) => {
      const bar = engineData.futureActualBar(actualCode, date);
      return bar?.settle ?? bar?.close ?? null;
    });

    this.sleeveNav.push({
      date,
      stockValue,
      futureValue: futuresPortfolio.cash,
      futureMargin: futuresPortfolio.margin,
      stockGrossExposure,
      futureNotional,
      netExposure: stockGrossExposure + futureNotional,
    });

    this.allocationTracker.captureDay({
      date,
      value: stockValue,
      positions: cashPortfolio.positions,
      closeOf: (code) => engineData.adjustedCloseAsOf(code, date),
      exactCloseOf: (code) => engineData.adjustedOhlcOn(code, date)?.close ?? null,
      trades: cashPortfolio.trades.slice(this.capturedTrades),
      rateRegime: classifyAllocationRateRegime(
        date,
        engineData.governmentYieldHistoryAsOf(10, date, 252),
        engineData.governmentYieldHistoryAsOf(2, date, 252),
      ),
    });
    this.capturedTrades = cashPortfolio.trades.length;
  }

  /**
   * 为当前决策日构造上下文并调用已准备的策略回调，将决策提交到订单簿。
   *
   * Construct the current decision context, invoke the prepared strategy callback and commit its orders.
   */
  private async runDecision(date: string, observeFactors: boolean): Promise<void> {
    this.orderBook.beginDecision(date);

    await this.factorEvaluator?.evaluate({
      date,
      codes: [
        ...(this.config.strategy.watch ?? []),
        ...this.cashPortfolio.positions.keys(),
        ...this.engineData.loadedBarCodes(),
      ],
    });

    const context = new BacktestingContext({
      date,
      engineData: this.engineData,
      cashPortfolio: this.cashPortfolio,
      futuresPortfolio: this.futuresPortfolio,
      factorEvaluator: this.factorEvaluator,
      orderBook: this.orderBook,
      onFactorRead: observeFactors
        ? (key, code, value) => {
            if (!isComputedFactorKey(key)) {
              return;
            }

            const byCode = this.factorObservations.get(key) ?? new Map<string, number | null>();
            byCode.set(code, value);
            this.factorObservations.set(key, byCode);
          }
        : undefined,
    });

    await this.config.strategy.onBar(context);

    this.orderBook.commitDecision();
  }

  /**
   * 组合净值、成交、成本和归因数据，生成完整回测报告。
   *
   * Combine NAV, fills, costs and allocation observations into the backtest report.
   */
  private collectResult(): BacktestingResult {
    const { config, engineData, cashPortfolio, futuresPortfolio } = this;

    const trades = [...cashPortfolio.trades, ...futuresPortfolio.trades].sort((left, right) =>
      left.date.localeCompare(right.date),
    );

    const result = summarizePerformance(
      config,
      this.nav,
      trades,
      engineData.indexCloses(BENCHMARK),
      this.cost,
      BENCHMARK,
      this.sleeveNav,
    );
    result.allocationAnalysis = this.allocationTracker.finish(
      cashPortfolio.equity((code) =>
        engineData.adjustedCloseAsOf(code, this.nav.at(-1)?.date ?? config.end),
      ),
    );

    this.logResult(result);

    return result;
  }

  /**
   * 仅在模拟成功后生成与内部状态分离的末日快照；补载待执行现金订单的数据可能失败。
   *
   * Builds a detached final-day snapshot after a successful run.
   * Loads missing cash-order market data before serializing; this may query the data port and fail.
   */
  async collectFinalState(): Promise<BacktestingFinalState> {
    if (!this.completed) {
      throw new Error('Final state requires a successfully completed engine run');
    }

    const tradeDate = this.nav.at(-1)?.date;

    if (!tradeDate) {
      throw new Error('Cannot retain final state from an empty trading range');
    }

    const { engineData, cashPortfolio } = this;
    const snapshot = this.orderBook.snapshotCashOrders();
    const codes = new Set([
      ...cashPortfolio.positions.keys(),
      ...(snapshot.pendingTargets?.keys() ?? []),
      ...(snapshot.pendingOrders?.keys() ?? []),
      ...(snapshot.pendingLotOrders?.keys() ?? []),
      ...[...snapshot.conditionalOrders.values()].map((order) => order.code),
    ]);

    await engineData.loadBars([...codes]);

    return serializeFinalState({
      ...snapshot,
      futureAccount: {
        equity: this.futuresPortfolio.cash,
        margin: this.futuresPortfolio.margin,
        availableCash: this.futuresPortfolio.availableCash,
        positions: structuredClone([...this.futuresPortfolio.positions.values()]),
      },
      futureOrders: this.orderBook.snapshotFuturesOrders(),
      futureMarket: this.engineData.snapshotFutures(tradeDate),
      tradeDate,
      equity: cashPortfolio.equity((code) => engineData.adjustedCloseAsOf(code, tradeDate)),
      cash: cashPortfolio.cash,
      positions: structuredClone(cashPortfolio.positions),
      market: new Map(
        [...codes].map((code) => [
          code,
          {
            assetType: engineData.assetType(code),
            adjustedClose: engineData.adjustedCloseAsOf(code, tradeDate),
            adjustmentFactor: engineData.adjustmentFactorAsOf(code, tradeDate),
            rawClose: engineData.rawCloseAsOf(code, tradeDate),
          },
        ]),
      ),
      factorObservations: [...this.factorObservations].flatMap(([key, byCode]) =>
        [...byCode].map(([code, value]) => ({ key, code, value })),
      ),
    });
  }

  private logStart(): void {
    this.log(
      t(this.locale, 'backtestStart', {
        start: day(this.config.start).format('YYYY-MM-DD'),
        end: day(this.config.end).format('YYYY-MM-DD'),
        cash: this.formatCny(this.config.initialCash),
      }),
    );
  }

  private logRebalance(date: string): void {
    this.log(
      t(this.locale, 'backtestRebalance', {
        date: day(date).format('YYYY-MM-DD'),
        count: this.cashPortfolio.positions.size,
      }),
    );
  }

  /**
   * 在首次进入新年份时报告年度进度和净值，减少逐日日志。
   *
   * Report progress and equity once per new simulation year.
   */
  private logProgress(completedDays: number, totalDays: number): void {
    const latestClose = this.nav.at(-1);

    if (!latestClose) {
      return;
    }

    const year = latestClose.date.slice(0, 4);

    if (year === this.lastLoggedYear) {
      return;
    }

    this.lastLoggedYear = year;
    this.log(
      t(this.locale, 'backtestYearlyHeartbeat', {
        year,
        equity: this.formatCny(latestClose.value),
        pct: Math.round((completedDays / totalDays) * 100),
      }),
    );
  }

  private logResult(result: BacktestingResult): void {
    this.log(
      t(this.locale, 'backtestDone', {
        days: result.days,
        trades: result.trades,
        finalValue: this.formatCny(result.finalValue),
        ret: (result.totalReturn * 100).toFixed(2),
      }),
    );
  }

  private formatCny(value: number): string {
    return `¥${this.cnyNumberFormat.format(Math.round(value))}`;
  }
}
