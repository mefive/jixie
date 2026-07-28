import type {
  BarsRows,
  CrossSectionRows,
  EngineDataPort,
  EtfBasicDataRow,
  FinaIndicatorRow,
  FutureContractRow,
  FutureDailyDataRow,
  FutureMappingDataRow,
  FutureSettlementDataRow,
  IndexDailyBasicDataRow,
  IndexDailyRow,
  IndexWeightRow,
  MoneyflowRow,
  StockBasicRow,
  StockNameHistoryRow,
  TopListRow,
} from './data-port.js';

/**
 * In-memory EngineDataPort built from a hand-written world — the direct-lane test double
 * (Phase B1). Lets engine-rule tests (T+1 / price limits / whole lots / fees / suspension) assert
 * deterministic outcomes on five-bar synthetic stocks instead of the 6.5GB real DB, and later
 * powers the dual-lane drift test (same fixture through the direct and walled lanes).
 */
export interface FixtureBar {
  date: string;
  open: number;
  high?: number;
  low?: number;
  close: number;
  vol?: number;
  amount?: number; // thousand yuan (the slippage impact denominator)
  turnoverRateF?: number; // free-float turnover rate, percent
  up?: number; // raw up-limit price
  down?: number; // raw down-limit price
  adj?: number; // adj_factor, default 1
}

export interface FixtureStock {
  code: string;
  assetType?: 'stock' | 'etf';
  listDate?: string; // default long ago (never "recently listed")
  industry?: string;
  nameHistory?: Omit<StockNameHistoryRow, 'tsCode'>[];
  bars: FixtureBar[];
  /** Optional per-date valuation overrides (peTtm etc.); a basic row is emitted for every bar
   * regardless, since the cross-section only includes codes that have one. */
  basic?: Record<string, Partial<CrossSectionRows['basic'][number]>>;
}

export interface FixtureSpec {
  dates: string[]; // open trading days, ascending
  stocks: FixtureStock[];
  indexDaily?: IndexDailyRow[];
  indexDailyBasic?: IndexDailyBasicDataRow[];
  indexWeights?: Record<string, IndexWeightRow[]>;
  finaIndicators?: FinaIndicatorRow[];
  topList?: TopListRow[];
  moneyflow?: MoneyflowRow[];
  futureContracts?: FutureContractRow[];
  futureDaily?: FutureDailyDataRow[];
  futureMappings?: FutureMappingDataRow[];
  futureSettlements?: FutureSettlementDataRow[];
}

export function fixturePort(spec: FixtureSpec): EngineDataPort {
  const barOf = new Map<string, FixtureBar>(); // `${code}|${date}`
  for (const stock of spec.stocks) {
    for (const bar of stock.bars) {
      barOf.set(`${stock.code}|${bar.date}`, bar);
    }
  }
  const inRange = (date: string, start: string, end: string) => date >= start && date <= end;

  return {
    async openDates(start, end) {
      return spec.dates.filter((d) => inRange(d, start, end));
    },

    async stockBasics(): Promise<StockBasicRow[]> {
      return spec.stocks
        .filter((stock) => stock.assetType !== 'etf')
        .map((stock) => ({
          tsCode: stock.code,
          listDate: stock.listDate ?? '20000101',
          industry: stock.industry ?? null,
        }));
    },

    async stockNameHistory(): Promise<StockNameHistoryRow[]> {
      return spec.stocks.flatMap((stock) =>
        (stock.nameHistory ?? []).map((spell) => ({ ...spell, tsCode: stock.code })),
      );
    },

    async etfBasics(): Promise<EtfBasicDataRow[]> {
      return spec.stocks
        .filter((stock) => stock.assetType === 'etf')
        .map((stock) => ({
          tsCode: stock.code,
          listDate: stock.listDate ?? '20000101',
          sameDayTurnover: false,
        }));
    },

    async topListRange(start, end) {
      return (spec.topList ?? []).filter((r) => inRange(r.tradeDate, start, end));
    },

    async indexDailyAll() {
      return spec.indexDaily ?? [];
    },

    async indexDailyBasicAll() {
      return spec.indexDailyBasic ?? [];
    },

    async moneyflowRange(start, end) {
      return (spec.moneyflow ?? []).filter((r) => inRange(r.tradeDate, start, end));
    },

    async crossSectionRows(date, codes) {
      const wanted = codes ? new Set(codes) : null;
      const out: CrossSectionRows = { price: [], adj: [], basic: [] };
      for (const stock of spec.stocks) {
        if (stock.assetType === 'etf') {
          continue;
        }
        if (wanted && !wanted.has(stock.code)) {
          continue;
        }
        const bar = barOf.get(`${stock.code}|${date}`);
        if (!bar) {
          continue; // suspended that day
        }
        out.price.push({
          tsCode: stock.code,
          open: bar.open,
          high: bar.high ?? bar.close,
          low: bar.low ?? bar.open,
          close: bar.close,
          vol: bar.vol ?? null,
          amount: bar.amount ?? null,
        });
        out.adj.push({ tsCode: stock.code, adjFactor: bar.adj ?? 1 });
        out.basic.push({
          tsCode: stock.code,
          pe: null,
          peTtm: null,
          pb: null,
          ps: null,
          psTtm: null,
          dvRatio: null,
          dvTtm: null,
          totalMv: null,
          circMv: null,
          turnoverRate: null,
          ...(stock.basic?.[date] ?? {}),
        });
      }
      return out;
    },

    async finaIndicators() {
      return spec.finaIndicators ?? [];
    },

    async indexWeights(indexCode) {
      return spec.indexWeights?.[indexCode] ?? [];
    },

    async barsRows(codes, start, end, options): Promise<BarsRows> {
      const wanted = new Set(codes);
      const out: BarsRows = { px: [], adj: [], limits: [], turnoverRatesF: [] };
      for (const stock of spec.stocks) {
        if (!wanted.has(stock.code)) {
          continue;
        }
        for (const bar of stock.bars) {
          if (!inRange(bar.date, start, end)) {
            continue;
          }
          out.px.push({
            tsCode: stock.code,
            tradeDate: bar.date,
            open: bar.open,
            high: bar.high ?? bar.close,
            low: bar.low ?? bar.open,
            close: bar.close,
            vol: bar.vol ?? null,
            amount: bar.amount ?? null,
          });
          out.adj.push({ tsCode: stock.code, tradeDate: bar.date, adjFactor: bar.adj ?? 1 });
          if (options?.includeTurnoverRateF) {
            out.turnoverRatesF.push({
              tsCode: stock.code,
              tradeDate: bar.date,
              turnoverRateF: bar.turnoverRateF ?? null,
            });
          }
          if (bar.up != null && bar.down != null) {
            out.limits.push({
              tsCode: stock.code,
              tradeDate: bar.date,
              upLimit: bar.up,
              downLimit: bar.down,
            });
          }
        }
      }
      return out;
    },

    async futuresRange(start, end) {
      return {
        contracts: (spec.futureContracts ?? []).filter(
          (row) => row.listDate <= end && row.delistDate >= start,
        ),
        daily: (spec.futureDaily ?? []).filter((row) => inRange(row.tradeDate, start, end)),
        mappings: (spec.futureMappings ?? []).filter((row) => inRange(row.tradeDate, start, end)),
        settlements: (spec.futureSettlements ?? []).filter((row) =>
          inRange(row.tradeDate, start, end),
        ),
      };
    },
  };
}
