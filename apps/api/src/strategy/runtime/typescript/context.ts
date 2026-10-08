import type { EngineContext } from '#backtesting/contract.js';
import type { BarRow, IndexHandle, OhlcBar } from '#backtesting/data/market.js';

interface StrategyContextAccess {
  access(input: string): string;
  request(input: Record<string, unknown>): Promise<unknown>;
}

interface HistoryUpdate {
  reset: boolean;
  bars: OhlcBar[];
}

export interface StrategyBarSnapshot {
  date: string;
  portfolio: { equity: number };
  stock: {
    equity: number;
    availableCash: number;
    positions: Array<{ code: string; shares: number; avgCost: number; marketValue: number }>;
  };
  futures: { equity: number; availableCash: number; margin: number };
  history_updates?: Record<string, HistoryUpdate>;
}

/** Keeps transport-backed reads and histories outside the author SDK. */
export class StrategyContextAdapter {
  private readonly reads = new Map<string, string>();
  private readonly histories = new Map<string, OhlcBar[]>();

  constructor(private readonly input: StrategyContextAccess) {}

  create(snapshot: StrategyBarSnapshot): EngineContext {
    this.reads.clear();
    this.updateHistories(snapshot.history_updates ?? {});

    // Cross-sections are immutable copies; the latest load replaces the visible panel, as in Engine.
    let rows = new Map<string, BarRow | null>();
    const core: EngineContext = {
      date: snapshot.date,
      portfolio: snapshot.portfolio,
      stock: {
        equity: snapshot.stock.equity,
        availableCash: snapshot.stock.availableCash,
        positions: () => snapshot.stock.positions.map((position) => ({ ...position })),
        adjustedShares: (code) => this.query('stock.adjustedShares', [code]) as number,
        setTargetWeight: (code, weight) => this.command('stock.setTargetWeight', { code, weight }),
        setTargetWeights: (weights) =>
          this.command('stock.setTargetWeights', {
            weights: weights instanceof Map ? Object.fromEntries(weights) : weights,
          }),
        orderAdjustedShares: (code, shares) =>
          this.command('stock.orderAdjustedShares', { code, shares }),
        orderLots: (code, lots) => this.command('stock.orderLots', { code, lots }),
        closePosition: (code) => this.command('stock.closePosition', { code }),
        stopLossAtAdjustedPrice: (code, price) =>
          this.command('stock.stopLossAtAdjustedPrice', { code, price }),
        trailingStopByFraction: (code, percentage) =>
          this.command('stock.trailingStopByFraction', { code, percentage }),
        limitBuyAtAdjustedPrice: (code, price, shares) =>
          this.command('stock.limitBuyAtAdjustedPrice', { code, price, shares }),
        takeProfitByFraction: (code, percentage) =>
          this.command('stock.takeProfitByFraction', { code, percentage }),
        cancelConditional: (code, kind) =>
          this.command('stock.cancelConditional', { code, kind: kind ?? null }),
      },
      futures: {
        equity: snapshot.futures.equity,
        availableCash: snapshot.futures.availableCash,
        margin: snapshot.futures.margin,
        position: (code) =>
          this.query('futures.position', [code]) as ReturnType<
            EngineContext['futures']['position']
          >,
        orderContracts: (code, contracts) =>
          this.command('futures.orderContracts', { code, contracts }),
        setTargetContracts: (code, contracts) =>
          this.command('futures.setTargetContracts', { code, contracts }),
        setTargetNotional: (code, notional) =>
          this.command('futures.setTargetNotional', { code, notional }),
        hedgeStock: (code, beta = 1) => this.command('futures.hedgeStock', { code, beta }),
        closePosition: (code) => this.command('futures.closePosition', { code }),
      },
      loadCrossSection: async (indexCode) => {
        const result = (await this.input.request({
          operation: 'cross_section',
          index_code: indexCode ?? null,
        })) as { codes: string[]; rows: Array<[string, BarRow | null]> };
        this.reads.clear();
        rows = new Map(result.rows);
        return result.codes;
      },
      ensureBars: async (codes) => {
        const result = (await this.input.request({
          operation: 'ensure_bars',
          codes: [...new Set(codes)],
        })) as {
          history_updates: Record<string, HistoryUpdate>;
        };
        this.updateHistories(result.history_updates);
        this.reads.clear();
      },
      indexMembers: async (indexCode) => {
        return (await this.input.request({
          operation: 'index_members',
          index_code: indexCode,
        })) as string[];
      },
      bar: (code) => rows.get(code) ?? null,
      bars: (code, n) =>
        this.cachedBars(code, n) ??
        (this.query('bars', [code, n]) as ReturnType<EngineContext['bars']>),
      resampledBars: (code, period, n) =>
        this.query('resampledBars', [code, period, n]) as ReturnType<
          EngineContext['resampledBars']
        >,
      listDays: (code) => this.query('listDays', [code]) as number | null,
      industry: (code) => this.query('industry', [code]) as string | null,
      lhbNet: (code) => this.query('lhbNet', [code]) as number | null,
      price: (code) =>
        this.histories.has(code)
          ? (this.histories.get(code)!.at(-1)?.adjClose ?? null)
          : (this.query('price', [code]) as number | null),
      history: (code, field, n) => {
        const bars = this.cachedBars(code, n);
        const column = {
          open: 'adjOpen',
          high: 'adjHigh',
          low: 'adjLow',
          close: 'adjClose',
        } as const;
        return bars
          ? bars.map((bar) => bar[column[field]])
          : (this.query('history', [code, field, n]) as number[]);
      },
      factor: (name, code) => this.query('factor', [name, code]) as number | null,
      future: (code) => this.query('future', [code]) as ReturnType<EngineContext['future']>,
      futureHistory: (code, field, n) => this.query('futureHistory', [code, field, n]) as number[],
      index: (indexCode) => {
        const values = this.query('indexValues', [indexCode]) as Pick<
          IndexHandle,
          'close' | 'pe' | 'peTtm' | 'pb'
        >;
        return {
          ...values,
          sma: (n) => this.query('indexSma', [indexCode, n]) as number | null,
          percentile: (field, lookback) =>
            this.query('indexPercentile', [indexCode, field, lookback ?? null]) as number | null,
        };
      },
    };

    return core;
  }

  private updateHistories(updates: Record<string, HistoryUpdate>): void {
    for (const [code, update] of Object.entries(updates)) {
      if (update.reset) {
        this.histories.set(code, update.bars);
      } else {
        this.histories.get(code)!.push(...update.bars);
      }
    }
  }

  private cachedBars(code: string, count: number): OhlcBar[] | undefined {
    const bars = this.histories.get(code);
    if (!bars || !Number.isSafeInteger(count) || count < 0) {
      return undefined;
    }

    return bars.slice(Math.max(0, bars.length - count)).map((bar) => ({ ...bar }));
  }

  private query(method: string, args: unknown[]): unknown {
    const key = JSON.stringify({ type: 'read', request: { method, args } });
    let json = this.reads.get(key);
    if (json == null) {
      json = this.input.access(key);
      const reply = JSON.parse(json);
      if ('error' in reply) {
        throw new Error(reply.error);
      }
      this.reads.set(key, json);
    }

    // Each caller receives its own data copy, never a mutable cached host object.
    return JSON.parse(json).result;
  }

  private access(input: unknown): unknown {
    const reply = JSON.parse(this.input.access(JSON.stringify(input)));
    if ('error' in reply) {
      throw new Error(reply.error);
    }

    return reply.result;
  }

  private command(operation: string, args: Record<string, unknown>): void {
    this.access({ type: 'command', command: { operation, arguments: args } });
  }
}
