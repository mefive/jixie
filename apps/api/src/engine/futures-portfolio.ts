import { EngineData } from './data.js';
import type { CostModel, FuturePositionView, TradeRecord } from './types.js';

interface FuturePosition {
  code: string;
  actualCode: string;
  contracts: number;
  referencePrice: number;
  multiplier: number;
  margin: number;
}

const FUTURE_TICK = 0.2;

/** Futures-only cash ledger: signed integer contracts, daily variation margin, margin reservation,
 * and transparent continuous-contract rolls. Cash is account equity after the latest settlement;
 * available cash is cash less current margin. */
export class FuturesPortfolio {
  cash: number;
  readonly positions = new Map<string, FuturePosition>();
  readonly trades: TradeRecord[] = [];

  constructor(
    initialCash: number,
    private readonly cost: CostModel,
  ) {
    this.cash = initialCash;
  }

  get margin(): number {
    let total = 0;
    for (const position of this.positions.values()) {
      total += position.margin;
    }
    return total;
  }

  get availableCash(): number {
    return this.cash - this.margin;
  }

  position(code: string): FuturePositionView | null {
    const position = this.positions.get(code);
    return position
      ? {
          code,
          actualCode: position.actualCode,
          contracts: position.contracts,
          margin: position.margin,
        }
      : null;
  }

  /** Signed futures exposure at the supplied price lookup. */
  notional(priceOf: (actualCode: string) => number | null): number {
    let total = 0;
    for (const position of this.positions.values()) {
      total +=
        position.contracts *
        (priceOf(position.actualCode) ?? position.referencePrice) *
        position.multiplier;
    }
    return total;
  }

  /** Roll positions at today's open using a mapping known on `mappingDate` (normally the previous
   * trading day). Both legs pay commission and slippage; the old leg realizes P&L from its latest
   * settlement reference before the new contract is opened. */
  roll(engineData: EngineData, date: string, mappingDate: string): void {
    for (const position of [...this.positions.values()]) {
      const desiredActualCode = engineData.futureExecutionCode(position.code, mappingDate, date);
      if (!desiredActualCode || desiredActualCode === position.actualCode) {
        continue;
      }
      const oldBar = engineData.futureActualBar(position.actualCode, date);
      const newBar = engineData.futureActualBar(desiredActualCode, date);
      if (oldBar?.open == null || newBar?.open == null) {
        continue;
      }

      const closeSide = position.contracts > 0 ? 'sell' : 'buy';
      const openSide = position.contracts > 0 ? 'buy' : 'sell';
      const oldFill = slippedPrice(oldBar.open, closeSide, this.cost);
      const newFill = slippedPrice(newBar.open, openSide, this.cost);
      const closeFee = futuresFee(
        Math.abs(position.contracts) * oldFill * position.multiplier,
        this.cost,
      );
      const openFee = futuresFee(
        Math.abs(position.contracts) * newFill * newBar.multiplier,
        this.cost,
      );
      const realized =
        position.contracts * (oldFill - position.referencePrice) * position.multiplier;
      const nextCash = this.cash + realized - closeFee - openFee;
      const nextMargin =
        Math.abs(position.contracts) *
        newFill *
        newBar.multiplier *
        marginRate(engineData, desiredActualCode, date, position.contracts, this.cost);
      const otherMargin = this.margin - position.margin;
      if (nextCash < otherMargin + nextMargin) {
        throw new Error(`Insufficient margin while rolling ${position.code} on ${date}`);
      }

      this.cash = nextCash;
      this.recordTrade(
        date,
        position.code,
        position.actualCode,
        closeSide,
        Math.abs(position.contracts),
        oldFill,
        position.multiplier,
        closeFee,
      );
      this.recordTrade(
        date,
        position.code,
        desiredActualCode,
        openSide,
        Math.abs(position.contracts),
        newFill,
        newBar.multiplier,
        openFee,
      );
      position.actualCode = desiredActualCode;
      position.referencePrice = newFill;
      position.multiplier = newBar.multiplier;
      position.margin = nextMargin;
    }
  }

  /** Execute one signed contract delta at today's open. Returns false when the requested position
   * would exceed available margin; rejected orders are not carried forward. */
  order(
    engineData: EngineData,
    code: string,
    delta: number,
    date: string,
    mappingDate: string,
  ): boolean {
    delta = Math.trunc(delta);
    if (delta === 0) {
      return false;
    }

    const current = this.positions.get(code);
    const actualCode =
      current?.actualCode ?? engineData.futureExecutionCode(code, mappingDate, date);
    if (!actualCode) {
      return false;
    }
    const bar = engineData.futureActualBar(actualCode, date);
    if (bar?.open == null) {
      return false;
    }
    const side = delta > 0 ? 'buy' : 'sell';
    const fillPrice = slippedPrice(bar.open, side, this.cost);
    const oldContracts = current?.contracts ?? 0;
    const newContracts = oldContracts + delta;
    const multiplier = current?.multiplier ?? bar.multiplier;
    const closedContracts =
      oldContracts === 0 || Math.sign(oldContracts) === Math.sign(delta)
        ? 0
        : Math.min(Math.abs(oldContracts), Math.abs(delta));
    const realized =
      closedContracts *
      Math.sign(oldContracts) *
      (fillPrice - (current?.referencePrice ?? fillPrice)) *
      multiplier;
    const notional = Math.abs(delta) * fillPrice * multiplier;
    const fee = futuresFee(notional, this.cost);
    const nextCash = this.cash + realized - fee;
    const nextMargin =
      Math.abs(newContracts) *
      fillPrice *
      multiplier *
      marginRate(engineData, actualCode, date, newContracts, this.cost);
    const otherMargin = this.margin - (current?.margin ?? 0);
    if (nextCash < otherMargin + nextMargin) {
      return false;
    }

    let nextReference = current?.referencePrice ?? fillPrice;
    if (
      oldContracts === 0 ||
      newContracts === 0 ||
      Math.sign(oldContracts) !== Math.sign(newContracts)
    ) {
      nextReference = fillPrice;
    } else if (Math.abs(newContracts) > Math.abs(oldContracts)) {
      const addedContracts = Math.abs(newContracts) - Math.abs(oldContracts);
      nextReference =
        (Math.abs(oldContracts) * nextReference + addedContracts * fillPrice) /
        Math.abs(newContracts);
    }

    this.cash = nextCash;
    this.recordTrade(date, code, actualCode, side, Math.abs(delta), fillPrice, multiplier, fee);
    if (newContracts === 0) {
      this.positions.delete(code);
    } else {
      this.positions.set(code, {
        code,
        actualCode,
        contracts: newContracts,
        referencePrice: nextReference,
        multiplier,
        margin: nextMargin,
      });
    }
    return true;
  }

  /** Credit/debit variation margin at today's settlement and refresh required margin. */
  settle(engineData: EngineData, date: string): void {
    for (const position of this.positions.values()) {
      const bar = engineData.futureActualBar(position.actualCode, date);
      if (bar?.settle == null) {
        throw new Error(`Missing settlement price for ${position.actualCode} on ${date}`);
      }
      this.cash +=
        position.contracts * (bar.settle - position.referencePrice) * position.multiplier;
      position.referencePrice = bar.settle;
      position.margin =
        Math.abs(position.contracts) *
        bar.settle *
        position.multiplier *
        marginRate(engineData, position.actualCode, date, position.contracts, this.cost);
    }
    if (this.availableCash < -1e-6) {
      throw new Error(
        `Futures margin call on ${date}: available cash ${this.availableCash.toFixed(2)}`,
      );
    }
  }

  private recordTrade(
    date: string,
    code: string,
    actualCode: string,
    side: 'buy' | 'sell',
    contracts: number,
    price: number,
    multiplier: number,
    fee: number,
  ): void {
    const amount = contracts * price * multiplier;
    this.trades.push({
      date,
      code,
      side,
      shares: contracts,
      price,
      amount,
      fee,
      realShares: contracts,
      realPrice: price,
      assetType: 'future',
      actualCode,
      contracts,
      multiplier,
    });
  }
}

function slippedPrice(open: number, side: 'buy' | 'sell', cost: CostModel): number {
  const slippage = cost.futureSlippageTicks * FUTURE_TICK;
  return side === 'buy' ? open + slippage : open - slippage;
}

function futuresFee(notional: number, cost: CostModel): number {
  return notional * cost.futureCommissionRate;
}

function marginRate(
  engineData: EngineData,
  actualCode: string,
  date: string,
  contracts: number,
  cost: CostModel,
): number {
  const sourceRate = engineData.futureMarginRate(
    actualCode,
    date,
    contracts >= 0 ? 'long' : 'short',
  );
  return sourceRate != null && sourceRate > 0 && sourceRate <= 1
    ? sourceRate
    : cost.futureMarginRate;
}
