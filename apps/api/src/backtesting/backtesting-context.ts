import type { EngineContext } from './contract.js';
import type { EngineData, CrossSection } from './data/engine-data.js';
import type { BarRow, OhlcBar, ResamplePeriod, IndexHandle } from './data/market.js';
import type { CashPortfolio } from './cash-portfolio.js';
import type { FactorEvaluator } from './factors/factor-evaluator.js';
import type { OrderBook } from './order-book.js';

/**
 * 装配一个决策日的引擎上下文，连接行情、账户、因子求值和订单收集能力。
 *
 * Supply the market, account, factor and order capabilities used to construct one decision-date context.
 */
interface BacktestingContextInput {
  date: string;
  engineData: EngineData;
  cashPortfolio: CashPortfolio;
  factorEvaluator: FactorEvaluator | null;
  orderBook: OrderBook;
  onFactorRead?: (key: string, code: string, value: number | null) => void;
}

/** One decision date; owns its lazily loaded crossSection-section, not the simulated accounts. */
export class BacktestingContext implements EngineContext {
  private crossSection: CrossSection | null = null;

  readonly portfolio: EngineContext['portfolio'];
  readonly stock: EngineContext['stock'];

  /**
   * 将当日行情、因子和账户绑定到引擎上下文，订单能力委托给订单簿。
   *
   * Bind dated market, factor and account capabilities to the context and delegate orders to the book.
   */
  constructor(private readonly input: BacktestingContextInput) {
    const { date, engineData, cashPortfolio, orderBook } = input;
    this.portfolio = {
      get equity() {
        return cashPortfolio.equity((code) => engineData.adjustedCloseAsOf(code, date));
      },
    };
    this.stock = {
      get equity() {
        return cashPortfolio.equity((code) => engineData.adjustedCloseAsOf(code, date));
      },
      get availableCash() {
        return cashPortfolio.cash;
      },
      positions: () =>
        [...cashPortfolio.positions].map(([code, position]) => ({
          code,
          shares: position.shares,
          avgCost: position.avgCost,
          marketValue: position.shares * (engineData.adjustedCloseAsOf(code, date) ?? 0),
        })),
      adjustedShares: (code) => cashPortfolio.positions.get(code)?.shares ?? 0,
      setTargetWeight: (code, weight) => orderBook.setStockTargetWeight(code, weight),
      setTargetWeights: (weights) => orderBook.setStockTargetWeights(weights),
      orderAdjustedShares: (code, shares) => orderBook.orderStockAdjustedShares(code, shares),
      orderLots: (code, lots) => orderBook.orderStockLots(code, lots),
      closePosition: (code) => orderBook.closeStockPosition(code),
      stopLossAtAdjustedPrice: (code, price) =>
        orderBook.setStockStopLossAtAdjustedPrice(code, price),
      trailingStopByFraction: (code, fraction) =>
        orderBook.setStockTrailingStopByFraction(code, fraction),
      limitBuyAtAdjustedPrice: (code, price, shares) =>
        orderBook.setStockLimitBuyAtAdjustedPrice(code, price, shares),
      takeProfitByFraction: (code, fraction) =>
        orderBook.setStockTakeProfitByFraction(code, fraction),
      cancelConditional: (code, kind) => orderBook.cancelStockConditional(code, kind),
    };
  }

  get date(): string {
    return this.input.date;
  }

  async loadCrossSection(indexCode?: string): Promise<string[]> {
    const { date, engineData, factorEvaluator } = this.input;

    this.crossSection = await engineData.crossSection(date, indexCode);
    await factorEvaluator?.evaluate({
      date,
      codes: this.crossSection.codes,
      crossSection: this.crossSection.byCode,
    });
    return this.crossSection.codes;
  }

  bar(code: string): BarRow | null {
    return this.crossSection?.byCode.get(code) ?? null;
  }

  bars(code: string, n: number): OhlcBar[] {
    const { date, engineData } = this.input;

    return engineData.bars(code, date, n);
  }

  resampledBars(code: string, period: ResamplePeriod, n: number): OhlcBar[] {
    const { date, engineData } = this.input;

    return engineData.resampledBars(code, date, period, n);
  }

  async ensureBars(codes: string[]): Promise<void> {
    const { date, engineData, factorEvaluator } = this.input;

    await engineData.loadBars(codes);
    await factorEvaluator?.evaluate({
      date,
      codes,
      crossSection: this.crossSection?.byCode ?? null,
    });
  }

  listDays(code: string): number | null {
    const { date, engineData } = this.input;

    return engineData.listDays(code, date);
  }

  price(code: string): number | null {
    const { date, engineData } = this.input;

    return engineData.adjustedCloseAsOf(code, date);
  }

  history(code: string, field: 'open' | 'high' | 'low' | 'close', n: number): number[] {
    const { date, engineData } = this.input;

    return engineData.history(code, date, field, n);
  }

  factor(name: string, code: string): number | null {
    const { date, factorEvaluator, onFactorRead } = this.input;

    if (!factorEvaluator?.has(name)) {
      throw new Error(`Factor is not available: ${name}`);
    }

    const value = factorEvaluator.read(name, date, code);
    onFactorRead?.(name, code, value);
    return value;
  }

  indexMembers(indexCode: string): Promise<string[]> {
    const { date, engineData } = this.input;

    return engineData.indexMembers(indexCode, date);
  }

  index(indexCode: string): IndexHandle {
    const { date, engineData } = this.input;

    return {
      get close() {
        return engineData.indexCloseAsOf(indexCode, date);
      },
      get pe() {
        return engineData.indexValuationAsOf(indexCode, date, 'pe');
      },
      get peTtm() {
        return engineData.indexValuationAsOf(indexCode, date, 'peTtm');
      },
      get pb() {
        return engineData.indexValuationAsOf(indexCode, date, 'pb');
      },
      sma(n: number) {
        return engineData.indexSma(indexCode, date, n);
      },
      percentile(field, lookback) {
        return engineData.indexValuationPercentile(indexCode, date, field, lookback);
      },
    };
  }
}
