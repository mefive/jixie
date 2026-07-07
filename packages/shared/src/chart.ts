/**
 * Chart cards inside agent conversations. Like query cards, a chart persists the QUERY that
 * produced it (a read-only SQL statement + column mapping) — never the data points — so reopening
 * a conversation re-runs it fresh and the chart stays honest about the local DB's current state.
 * The SQL is validated server-side against the market-table whitelist (agent/tools/read-only-sql).
 */
export type ChartKind = 'line' | 'bar' | 'scatter';

export interface ChartSeriesSpec {
  column: string; // result-set column holding this series' y values
  label?: string; // legend label (defaults to the column name)
}

export interface ChartSpec {
  kind: ChartKind;
  sql: string; // single read-only SELECT (SQLite dialect), row-capped server-side
  x: string; // result-set column for the x axis (categories, e.g. tradeDate / industry)
  series: ChartSeriesSpec[];
}

/** Result rows of the read-only SQL endpoint (loose typing: SQLite scalars only). */
export interface SqlRows {
  rows: Record<string, string | number | null>[];
}
