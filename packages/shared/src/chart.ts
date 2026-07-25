/**
 * Chart cards inside agent conversations. Like query cards, a chart persists the QUERY that
 * produced it — never the data points — so reopening a conversation re-runs it fresh and the chart
 * stays honest about the local DB's current state. Two sources (design: computed-chart.md):
 *   - 'sql' (default): a single read-only SELECT produces the rows directly;
 *   - 'compute': 1–4 SELECTs feed a sandboxed JS transform (same isolate + stats as analyzeData),
 *     whose returned row table is drawn.
 * The SQL is validated server-side against the market-table whitelist (agent/tools/read-only-sql).
 */
export type ChartKind =
  | 'line'
  | 'bar'
  | 'scatter'
  | 'area' // line with a filled area — NAV / cumulative-return shapes
  | 'stackedBar' // bars stacked into a total — composition over categories/time
  | 'histogram' // distribution bars (bucket with GROUP BY in SQL first)
  | 'combo'; // mixed line/bar series, optional right-hand y axis (price + volume shapes)

export interface ChartSeriesSpec {
  column: string; // result-set column holding this series' y values
  label?: string; // legend label (defaults to the column name)
  type?: 'line' | 'bar'; // combo only: per-series mark (defaults to line)
  yAxis?: 'left' | 'right'; // combo only: 'right' puts the series on a second value axis
}

export interface ChartQuerySpec {
  name: string; // the variable name for this result in code (data.<name>)
  sql: string; // single read-only SELECT (SQLite dialect)
}

/** A chart drawn straight from one read-only SQL result (source omitted = legacy cards). */
export interface SqlChartSpec {
  source?: 'sql';
  kind: ChartKind;
  sql: string; // single read-only SELECT (SQLite dialect), row-capped server-side
  x: string; // result-set column for the x axis (categories, e.g. tradeDate / industry)
  series: ChartSeriesSpec[];
}

/** A chart whose rows come from a sandboxed JS transform over 1–4 SQL results. */
export interface ComputeChartSpec {
  source: 'compute';
  kind: ChartKind;
  queries: ChartQuerySpec[];
  code: string; // export default ({ data, stats }) => rows (array of flat objects)
  x: string;
  series: ChartSeriesSpec[];
}

export type ChartSpec = SqlChartSpec | ComputeChartSpec;

/** Result rows of the read-only SQL endpoint (loose typing: SQLite scalars only). */
export interface SqlRows {
  rows: Record<string, string | number | null>[];
}
