import { UserCodeError } from '#infra/errors.js';
import { AgentError } from '../../errors.js';
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
    throw new AgentError('chart_columns_missing', {
      params: { missing: missing.join(', '), available: availableColumns.join(', ') },
    });
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
    throw new AgentError('chart_rows_invalid');
  }
  if (!rows.length) {
    throw new AgentError('chart_rows_empty');
  }
  if (rows.length > CHART_ROW_CAP) {
    throw new AgentError('chart_row_limit', {
      params: { rows: rows.length, limit: CHART_ROW_CAP },
    });
  }

  const normalized: Record<string, string | number | null>[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new AgentError('chart_rows_flat');
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
        throw new AgentError('chart_field_scalar', { params: { field: key } });
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
    throw new AgentError('chart_query_names_unique');
  }

  const data: Record<string, Record<string, unknown>[]> = {};
  for (const query of spec.queries) {
    data[query.name] = await runReadOnlySql(query.sql, COMPUTE_QUERY_ROW_CAP);
  }

  let result: unknown;
  try {
    result = await runAnalysisCode(spec.code, data, { timeoutMs: EXECUTION_TIMEOUT_MS });
  } catch (error) {
    if (!(error instanceof UserCodeError)) {
      throw error;
    }
    throw new AgentError('chart_code_invalid', {
      params: { diagnostic: error.message },
      cause: error,
    });
  }
  return normalizeComputeChartRows(result, spec);
}
