import type { EngineContext } from './contract.js';
import type { EngineData, CrossSection } from './data/engine-data.js';
import type { BarRow, OhlcBar, ResamplePeriod, IndexHandle, FutureBar } from './data/market.js';
import type { FuturesPortfolio } from './futures-portfolio.js';
import type { CashPortfolio } from './cash-portfolio.js';
import type { FactorEvaluator } from './factors/evaluator.js';
import type { OrderBook } from './order-book.js';

interface BacktestingContextInput {
  date: string;
  engineData: EngineData;
  cashPortfolio: CashPortfolio;
  futuresPortfolio: FuturesPortfolio;
  factorEvaluator: FactorEvaluator | null;
  orderBook: OrderBook;
  onFactorRead?: (key: string, code: string, value: number | null) => void;
}

/** One decision date; owns its lazily loaded crossSection-section, not the simulated accounts. */
export class BacktestingContext implements EngineContext {
  private crossSection: CrossSection | null = null;

  readonly portfolio: EngineContext['portfolio'];
  readonly stock: EngineContext['stock'];
  readonly futures: EngineContext['futures'];

  constructor(private readonly input: BacktestingContextInput) {
    const { date, engineData, cashPortfolio, futuresPortfolio, orderBook } = input;
    this.portfolio = {
      get equity() {
        return (
          cashPortfolio.equity((code) => engineData.adjustedCloseAsOf(code, date)) +
          futuresPortfolio.cash
        );
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
    this.futures = {
      get equity() {
        return futuresPortfolio.cash;
      },
      get availableCash() {
        return futuresPortfolio.availableCash;
      },
      get margin() {
        return futuresPortfolio.margin;
      },
      position: (code) => futuresPortfolio.position(code),
      orderContracts: (code, contracts) => orderBook.orderFuturesContracts(code, contracts),
      setTargetContracts: (code, contracts) => orderBook.setFuturesTargetContracts(code, contracts),
      setTargetNotional: (code, notional) => orderBook.setFuturesTargetNotional(code, notional),
      hedgeStock: (code, beta) => orderBook.hedgeStockWithFutures(code, beta),
      closePosition: (code) => orderBook.closeFuturesPosition(code),
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

  industry(code: string): string | null {
    const { date, engineData } = this.input;

    return engineData.industry(code, date);
  }

  lhbNet(code: string): number | null {
    const { date, engineData } = this.input;

    return engineData.lhbNet(code, date);
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
    const { date, engineData, factorEvaluator, onFactorRead } = this.input;

    const value = factorEvaluator?.has(name)
      ? factorEvaluator.read(name, date, code)
      : engineData.factor(name, date, code);
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

  future(code: string): FutureBar | null {
    return this.input.engineData.futureBar(code, this.input.date);
  }

  futureHistory(
    code: string,
    field: 'open' | 'high' | 'low' | 'close' | 'settle',
    n: number,
  ): number[] {
    return this.input.engineData.futureHistory(code, this.input.date, field, n);
  }
}
