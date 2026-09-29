import type { EngineContext } from './contract.js';
import type { EngineData, CrossSection } from './data/engine-data.js';
import type { BarRow, OhlcBar, ResamplePeriod, IndexHandle, FutureBar } from './data/market.js';
import type { FuturePositionView, FuturesPortfolio } from './futures-portfolio.js';
import type { CashPortfolio } from './cash-portfolio.js';
import type { FactorEvaluator } from './factors/evaluator.js';
import type { OrderBook, ConditionalOrderKind } from './order-book.js';

interface BacktestingContextInput {
  date: string;
  engineData: EngineData;
  cashPortfolio: CashPortfolio;
  futuresPortfolio: FuturesPortfolio | null;
  factorEvaluator: FactorEvaluator | null;
  orderBook: OrderBook;
  onFactorRead?: (key: string, code: string, value: number | null) => void;
}

/** One decision date; owns its lazily loaded crossSection-section, not the simulated accounts. */
export class BacktestingContext implements EngineContext {
  private crossSection: CrossSection | null = null;

  constructor(private readonly input: BacktestingContextInput) {}

  get date(): string {
    return this.input.date;
  }

  get cash(): number {
    const { cashPortfolio, futuresPortfolio } = this.input;

    return cashPortfolio.cash + (futuresPortfolio?.cash ?? 0);
  }

  get value(): number {
    const { date, engineData, cashPortfolio, futuresPortfolio } = this.input;

    return (
      cashPortfolio.equity((code) => engineData.adjustedCloseAsOf(code, date)) +
      (futuresPortfolio?.cash ?? 0)
    );
  }

  get availableCash(): number {
    const { cashPortfolio, futuresPortfolio } = this.input;

    return cashPortfolio.cash + (futuresPortfolio?.availableCash ?? 0);
  }

  get stockValue(): number {
    const { date, engineData, cashPortfolio } = this.input;

    return cashPortfolio.equity((code) => engineData.adjustedCloseAsOf(code, date));
  }

  get futureValue(): number {
    const { futuresPortfolio } = this.input;

    return futuresPortfolio?.cash ?? 0;
  }

  get stockAvailableCash(): number {
    const { cashPortfolio } = this.input;

    return cashPortfolio.cash;
  }

  get futureAvailableCash(): number {
    const { futuresPortfolio } = this.input;

    return futuresPortfolio?.availableCash ?? 0;
  }

  get futureMargin(): number {
    const { futuresPortfolio } = this.input;

    return futuresPortfolio?.margin ?? 0;
  }

  positions(): { code: string; shares: number; avgCost: number; marketValue: number }[] {
    const { date, engineData, cashPortfolio } = this.input;

    return [...cashPortfolio.positions].map(([code, position]) => ({
      code,
      shares: position.shares,
      avgCost: position.avgCost,
      marketValue: position.shares * (engineData.adjustedCloseAsOf(code, date) ?? 0),
    }));
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
    return this.input.futuresPortfolio
      ? this.input.engineData.futureBar(code, this.input.date)
      : null;
  }

  futureHistory(
    code: string,
    field: 'open' | 'high' | 'low' | 'close' | 'settle',
    n: number,
  ): number[] {
    return this.input.futuresPortfolio
      ? this.input.engineData.futureHistory(code, this.input.date, field, n)
      : [];
  }

  futurePosition(code: string): FuturePositionView | null {
    const { futuresPortfolio } = this.input;

    return futuresPortfolio?.position(code) ?? null;
  }

  orderTargetPercent(code: string, weight: number): void {
    return this.input.orderBook.orderTargetPercent(code, weight);
  }

  setHoldings(weights: Record<string, number> | Map<string, number>): void {
    return this.input.orderBook.setHoldings(weights);
  }

  order(code: string, shares: number): void {
    return this.input.orderBook.order(code, shares);
  }

  orderLots(code: string, lots: number): void {
    return this.input.orderBook.orderLots(code, lots);
  }

  exit(code: string): void {
    return this.input.orderBook.exit(code);
  }

  stopLoss(code: string, price: number): void {
    return this.input.orderBook.stopLoss(code, price);
  }

  trailingStop(code: string, pct: number): void {
    return this.input.orderBook.trailingStop(code, pct);
  }

  limitBuy(code: string, price: number, shares: number): void {
    return this.input.orderBook.limitBuy(code, price, shares);
  }

  takeProfit(code: string, pct: number): void {
    return this.input.orderBook.takeProfit(code, pct);
  }

  cancelConditional(code: string, kind?: ConditionalOrderKind): void {
    return this.input.orderBook.cancelConditional(code, kind);
  }

  shares(code: string): number {
    const { cashPortfolio } = this.input;

    return cashPortfolio.positions.get(code)?.shares ?? 0;
  }

  orderFuture(code: string, contracts: number): void {
    return this.input.orderBook.orderFuture(code, contracts);
  }

  setFutureTargetContracts(code: string, contracts: number): void {
    return this.input.orderBook.setFutureTargetContracts(code, contracts);
  }

  setFutureTargetNotional(code: string, notional: number): void {
    return this.input.orderBook.setFutureTargetNotional(code, notional);
  }

  hedgeFuture(code: string, beta = 1): void {
    return this.input.orderBook.hedgeFuture(code, beta);
  }

  exitFuture(code: string): void {
    return this.input.orderBook.exitFuture(code);
  }
}
