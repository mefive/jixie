import { runAnalysisCode } from '../analyze-sandbox.js';
import { runReadOnlySql } from '../sql/read-only-sql.js';

/** Compatibility execution for persisted SQL/compute charts, not an Agent tool.
 * Charts allow more points than a tabular observation (a 2-year daily series is about 490 rows). */
export const CHART_ROW_CAP = 500;

const COMPUTE_QUERY_ROW_CAP = 10_000;
const EXECUTION_TIMEOUT_MS = 10_000;

/** The columns a spec maps must exist on the actual rows — reject invalid historical
 * specifications instead of displaying an empty chart. */
export function assertChartColumns(
  rows: Record<string, unknown>[],
  spec: { x: string; series: { column: string }[] },
): void {
  const availableColumns = Object.keys(rows[0] ?? {});
  const missing = [spec.x, ...spec.series.map((series) => series.column)].filter(
    (column) => !availableColumns.includes(column),
  );
  if (missing.length) {
    throw new Error(
      `The result set has no such columns: ${missing.join(', ')} (actual columns: ${availableColumns.join(', ')})`,
    );
  }
}

/** Coerce and validate a sandbox result into a drawable row table (pure — unit-testable):
 * an array of flat scalar objects (or { rows }), capped, containing every mapped column. */
export function normalizeComputeChartRows(
  result: unknown,
  spec: { x: string; series: { column: string }[] },
): Record<string, string | number | null>[] {
  const rows = Array.isArray(result)
    ? result
    : result && typeof result === 'object' && Array.isArray((result as { rows?: unknown }).rows)
      ? ((result as { rows: unknown[] }).rows as unknown[])
      : null;
  if (!rows) {
    throw new Error(
      'The code must return an ARRAY of flat row objects (or { rows: [...] }) to draw',
    );
  }
  if (!rows.length) {
    throw new Error(
      'The code returned no rows, so no chart can be drawn; check the queries or the transform',
    );
  }
  if (rows.length > CHART_ROW_CAP) {
    throw new Error(
      `The code returned ${rows.length} rows (cap ${CHART_ROW_CAP}); aggregate or sample down in the code (e.g. monthly points instead of daily)`,
    );
  }

  const normalized: Record<string, string | number | null>[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('Every returned row must be a flat object of scalars');
    }
    const flat: Record<string, string | number | null> = {};
    for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
      if (value == null) {
        flat[key] = null;
      } else if (typeof value === 'number' || typeof value === 'string') {
        flat[key] = value;
      } else if (typeof value === 'bigint') {
        flat[key] = Number(value);
      } else {
        throw new Error(
          `Row field '${key}' is not a scalar; rows must hold numbers/strings/null only`,
        );
      }
    }
    normalized.push(flat);
  }
  assertChartColumns(normalized, spec);
  return normalized;
}

/** Execute a compute chart spec: run its queries, run its code in the isolate, normalize the
 * returned row table. Used only by the historical chart re-run endpoint. */
export async function runComputeChartRows(spec: {
  queries: { name: string; sql: string }[];
  code: string;
  x: string;
  series: { column: string }[];
}): Promise<Record<string, string | number | null>[]> {
  const names = new Set(spec.queries.map((query) => query.name));
  if (names.size !== spec.queries.length) {
    throw new Error('query names must be unique');
  }

  const data: Record<string, Record<string, unknown>[]> = {};
  for (const query of spec.queries) {
    data[query.name] = await runReadOnlySql(query.sql, COMPUTE_QUERY_ROW_CAP);
  }

  const result = await runAnalysisCode(spec.code, data, { timeoutMs: EXECUTION_TIMEOUT_MS });
  return normalizeComputeChartRows(result, spec);
}
