import type { StrategyCapabilities, StrategyStockCapabilities } from '../../sdk/capabilities.js';
import type { SdkAdapter } from '#infra/runtime/sdk-adapter.js';
import type { BarRow, IndexHandle, OhlcBar } from '#backtesting/data/market.js';

interface StrategyAdapterAccess {
  access(input: string): string;
  request(input: Record<string, unknown>): Promise<unknown>;
}

interface HistoryUpdate {
  reset: boolean;
  bars: OhlcBar[];
}

interface StrategyAdapterState {
  reads: Map<string, string>;
  histories: Map<string, OhlcBar[]>;
}

type StrategyQuery = (method: string, args: unknown[]) => unknown;
type StrategyCommand = (operation: string, args: Record<string, unknown>) => void;

interface StrategyStockSnapshot {
  equity: number;
  availableCash: number;
  positions: Array<{ code: string; shares: number; avgCost: number; marketValue: number }>;
}

interface StrategyFuturesSnapshot {
  equity: number;
  availableCash: number;
  margin: number;
}

export interface StrategyAdapterInput {
  date: string;
  portfolio: { equity: number };
  stock: StrategyStockSnapshot;
  futures: StrategyFuturesSnapshot;
  history_updates?: Record<string, HistoryUpdate>;
}

/** One session owns the cache; each binding owns its snapshot and visible cross-section. */
export class StrategyAdapter implements SdkAdapter<StrategyAdapterInput, StrategyCapabilities> {
  private readonly state: StrategyAdapterState = {
    reads: new Map(),
    histories: new Map(),
  };

  constructor(private readonly input: StrategyAdapterAccess) {}

  bind(input: StrategyAdapterInput): StrategyCapabilities {
    this.state.reads.clear();
    updateHistories(this.state.histories, input.history_updates ?? {});

    return new BoundStrategyCapabilities(input, this.state, this.input);
  }
}

class BoundStockAccountCapabilities implements StrategyStockCapabilities {
  private readonly snapshot: StrategyStockSnapshot;

  constructor(
    snapshot: StrategyStockSnapshot,
    private readonly query: StrategyQuery,
    private readonly command: StrategyCommand,
  ) {
    this.snapshot = { ...snapshot };
  }

  get equity(): number {
    return this.snapshot.equity;
  }

  get availableCash(): number {
    return this.snapshot.availableCash;
  }

  positions() {
    return this.snapshot.positions.map((position) => ({ ...position }));
  }

  adjustedShares(code: string): number {
    return this.query('stock.adjustedShares', [code]) as number;
  }

  setTargetWeight(code: string, weight: number): void {
    this.command('stock.setTargetWeight', { code, weight });
  }

  setTargetWeights(weights: Record<string, number> | Map<string, number>): void {
    this.command('stock.setTargetWeights', {
      weights: weights instanceof Map ? Object.fromEntries(weights) : weights,
    });
  }

  orderAdjustedShares(code: string, shares: number): void {
    this.command('stock.orderAdjustedShares', { code, shares });
  }

  orderLots(code: string, lots: number): void {
    this.command('stock.orderLots', { code, lots });
  }

  closePosition(code: string): void {
    this.command('stock.closePosition', { code });
  }

  stopLossAtAdjustedPrice(code: string, price: number): void {
    this.command('stock.stopLossAtAdjustedPrice', { code, price });
  }

  trailingStopByFraction(code: string, percentage: number): void {
    this.command('stock.trailingStopByFraction', { code, percentage });
  }

  limitBuyAtAdjustedPrice(code: string, price: number, shares: number): void {
    this.command('stock.limitBuyAtAdjustedPrice', { code, price, shares });
  }

  takeProfitByFraction(code: string, percentage: number): void {
    this.command('stock.takeProfitByFraction', { code, percentage });
  }

  cancelConditional(
    code: string,
    kind?: Parameters<StrategyStockCapabilities['cancelConditional']>[1],
  ): void {
    this.command('stock.cancelConditional', { code, kind: kind ?? null });
  }
}

class BoundStrategyCapabilities implements StrategyCapabilities {
  readonly date: string;
  readonly portfolio: StrategyCapabilities['portfolio'];
  readonly stock: StrategyStockCapabilities;
  readonly futures: StrategyCapabilities['futures'];
  private rows = new Map<string, BarRow | null>();

  constructor(
    snapshot: StrategyAdapterInput,
    private readonly state: StrategyAdapterState,
    private readonly input: StrategyAdapterAccess,
  ) {
    this.date = snapshot.date;
    this.portfolio = snapshot.portfolio;
    this.stock = new BoundStockAccountCapabilities(
      snapshot.stock,
      (method, args) => this.query(method, args),
      (operation, args) => this.command(operation, args),
    );
    this.futures = {
      equity: snapshot.futures.equity,
      availableCash: snapshot.futures.availableCash,
      margin: snapshot.futures.margin,
      position: (code) =>
        this.query('futures.position', [code]) as ReturnType<
          StrategyCapabilities['futures']['position']
        >,
      orderContracts: (code, contracts) =>
        this.command('futures.orderContracts', { code, contracts }),
      setTargetContracts: (code, contracts) =>
        this.command('futures.setTargetContracts', { code, contracts }),
      setTargetNotional: (code, notional) =>
        this.command('futures.setTargetNotional', { code, notional }),
      hedgeStock: (code, beta = 1) => this.command('futures.hedgeStock', { code, beta }),
      closePosition: (code) => this.command('futures.closePosition', { code }),
    };
  }

  async loadCrossSection(indexCode?: string): Promise<string[]> {
    const result = (await this.input.request({
      operation: 'cross_section',
      index_code: indexCode ?? null,
    })) as { codes: string[]; rows: Array<[string, BarRow | null]> };
    this.state.reads.clear();

    // Cross-sections are immutable copies; the latest load replaces the visible panel, as in Engine.
    this.rows = new Map(result.rows);

    return result.codes;
  }

  bar(code: string): BarRow | null {
    return this.rows.get(code) ?? null;
  }

  async ensureBars(codes: Iterable<string>): Promise<void> {
    const result = (await this.input.request({
      operation: 'ensure_bars',
      codes: [...new Set(codes)],
    })) as { history_updates: Record<string, HistoryUpdate> };
    updateHistories(this.state.histories, result.history_updates);
    this.state.reads.clear();
  }

  bars(code: string, count: number): OhlcBar[] {
    return this.cachedBars(code, count) ?? (this.query('bars', [code, count]) as OhlcBar[]);
  }

  history(code: string, field: 'open' | 'high' | 'low' | 'close', count: number): number[] {
    const bars = this.cachedBars(code, count);
    const column = { open: 'adjOpen', high: 'adjHigh', low: 'adjLow', close: 'adjClose' } as const;

    return bars
      ? bars.map((bar) => bar[column[field]])
      : (this.query('history', [code, field, count]) as number[]);
  }

  price(code: string): number | null {
    return this.state.histories.has(code)
      ? (this.state.histories.get(code)!.at(-1)?.adjClose ?? null)
      : (this.query('price', [code]) as number | null);
  }

  listDays(code: string): number | null {
    return this.query('listDays', [code]) as number | null;
  }

  industry(code: string): string | null {
    return this.query('industry', [code]) as string | null;
  }

  lhbNet(code: string): number | null {
    return this.query('lhbNet', [code]) as number | null;
  }

  factor(name: string, code: string): number | null {
    return this.query('factor', [name, code]) as number | null;
  }

  resampledBars(code: string, period: 'weekly' | 'monthly', count: number): OhlcBar[] {
    return this.query('resampledBars', [code, period, count]) as OhlcBar[];
  }

  async indexMembers(indexCode: string): Promise<string[]> {
    return (await this.input.request({
      operation: 'index_members',
      index_code: indexCode,
    })) as string[];
  }

  index(indexCode: string): ReturnType<StrategyCapabilities['index']> {
    const values = this.query('indexValues', [indexCode]) as Pick<
      IndexHandle,
      'close' | 'pe' | 'peTtm' | 'pb'
    >;

    return {
      ...values,
      sma: (count) => this.query('indexSma', [indexCode, count]) as number | null,
      percentile: (field, lookback) =>
        this.query('indexPercentile', [indexCode, field, lookback ?? null]) as number | null,
    };
  }

  future(code: string): ReturnType<StrategyCapabilities['future']> {
    return this.query('future', [code]) as ReturnType<StrategyCapabilities['future']>;
  }

  futureHistory(
    code: string,
    field: Parameters<StrategyCapabilities['futureHistory']>[1],
    count: number,
  ): number[] {
    return this.query('futureHistory', [code, field, count]) as number[];
  }

  private cachedBars(code: string, count: number): OhlcBar[] | undefined {
    const bars = this.state.histories.get(code);
    if (!bars || !Number.isSafeInteger(count) || count < 0) {
      return undefined;
    }

    return bars.slice(Math.max(0, bars.length - count)).map((bar) => ({ ...bar }));
  }

  private query(method: string, args: unknown[]): unknown {
    const key = JSON.stringify({ type: 'read', request: { method, args } });
    let json = this.state.reads.get(key);
    if (json == null) {
      json = this.input.access(key);
      const reply = JSON.parse(json);
      if ('error' in reply) {
        throw new Error(reply.error);
      }
      this.state.reads.set(key, json);
    }

    // Each caller receives its own data copy, never a mutable cached host object.
    return JSON.parse(json).result;
  }

  private command(operation: string, args: Record<string, unknown>): void {
    const reply = JSON.parse(
      this.input.access(
        JSON.stringify({ type: 'command', command: { operation, arguments: args } }),
      ),
    );
    if ('error' in reply) {
      throw new Error(reply.error);
    }
  }
}

function updateHistories(
  histories: Map<string, OhlcBar[]>,
  updates: Record<string, HistoryUpdate>,
): void {
  for (const [code, update] of Object.entries(updates)) {
    if (update.reset) {
      histories.set(code, update.bars);
    } else {
      histories.get(code)!.push(...update.bars);
    }
  }
}
