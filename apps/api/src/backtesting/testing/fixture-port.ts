import type {
  BarsRows,
  CrossSectionRows,
  EngineDataPort,
  EtfBasicDataRow,
  FinaIndicatorRow,
  IndexDailyBasicDataRow,
  IndexDailyRow,
  IndexWeightRow,
  StockBasicRow,
  StockNameHistoryRow,
} from '../data/data-port.js';
import { CSI_300_TOTAL_RETURN_INDEX_CODE } from '#market/registry/index-presets.js';

/** Deterministic in-memory market data shared by engine-rule and strategy runtime tests. */
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
  delistDate?: string;
  listStatus?: string;
  nameHistory?: Omit<StockNameHistoryRow, 'tsCode'>[];
  bars: FixtureBar[];
  /** Optional per-date valuation overrides (peTtm etc.); a basic row is emitted for every bar
   * regardless, since the cross-section only includes codes that have one. */
  basic?: Record<string, Partial<CrossSectionRows['basic'][number]>>;
}

export interface FixtureSpec {
  dates: string[]; // open trading days, ascending
  stocks: FixtureStock[];
  /**
   * 成交类测试可显式提供已知价格限制；省略时仍表示输入缺失。
   *
   * Execution fixtures may supply known price limits; omission still means missing inputs.
   */
  stockPriceLimits?: { up: number; down: number };
  indexDaily?: IndexDailyRow[];
  indexDailyBasic?: IndexDailyBasicDataRow[];
  indexWeights?: Record<string, IndexWeightRow[]>;
  finaIndicators?: FinaIndicatorRow[];
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
          delistDate: stock.delistDate ?? null,
          listStatus: stock.listStatus ?? (stock.delistDate ? 'D' : 'L'),
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
          delistDate: stock.delistDate ?? null,
          listStatus: stock.listStatus ?? (stock.delistDate ? 'D' : 'L'),
          sameDayTurnover: false,
        }));
    },

    async indexDailyAll() {
      const rows = [...(spec.indexDaily ?? [])];
      if (!rows.some((row) => row.tsCode === CSI_300_TOTAL_RETURN_INDEX_CODE)) {
        rows.push(
          ...spec.dates.map((tradeDate) => ({
            tsCode: CSI_300_TOTAL_RETURN_INDEX_CODE,
            tradeDate,
            close: 1,
          })),
        );
      }
      return rows;
    },

    async indexDailyBasicAll() {
      return spec.indexDailyBasic ?? [];
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
          const up = bar.up ?? spec.stockPriceLimits?.up;
          const down = bar.down ?? spec.stockPriceLimits?.down;
          if (up != null && down != null) {
            out.limits.push({
              tsCode: stock.code,
              tradeDate: bar.date,
              upLimit: up,
              downLimit: down,
            });
          }
        }
      }
      return out;
    },
  };
}
