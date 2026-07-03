import { z } from 'zod';
import type { ScreenField, ScreenRow, ScreenSpec } from '@jixie/shared';

/** Zod schema + pure filter/sort for the stock screener. The DB-touching part lives in query.ts; the
 * logic here is pure (and unit-tested) so it can be checked without a database. */

const fieldEnum = z.enum([
  'close',
  'pctChg',
  'pe',
  'peTtm',
  'pb',
  'ps',
  'dvRatio',
  'totalMv',
  'circMv',
  'turnoverRate',
]);

export const screenSpecSchema = z.object({
  filters: z.array(
    z.object({ field: fieldEnum, op: z.enum(['>', '>=', '<', '<=']), value: z.number() }),
  ),
  sort: z.object({ field: fieldEnum, dir: z.enum(['asc', 'desc']) }).optional(),
  limit: z.number().int().positive().max(200).optional(),
});

export const DEFAULT_LIMIT = 50;

export function validateScreenSpec(
  obj: unknown,
): { ok: true; spec: ScreenSpec } | { ok: false; errors: string[] } {
  const r = screenSpecSchema.safeParse(obj);
  if (r.success) {
    return { ok: true, spec: r.data as ScreenSpec };
  }
  return {
    ok: false,
    errors: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}

function cmp(v: number | null, op: string, value: number): boolean {
  if (v == null || !Number.isFinite(v)) {
    return false;
  } // missing data never passes a numeric filter
  return op === '>' ? v > value : op === '>=' ? v >= value : op === '<' ? v < value : v <= value;
}

/** Filter rows by the spec's predicates, sort, and limit. Returns matches before-limit count too. */
export function applyScreen(
  rows: ScreenRow[],
  spec: ScreenSpec,
): { total: number; rows: ScreenRow[] } {
  let out = rows.filter((row) =>
    spec.filters.every((f) => cmp(row[f.field as ScreenField] as number | null, f.op, f.value)),
  );
  const total = out.length;

  if (spec.sort) {
    const { field, dir } = spec.sort;
    const sign = dir === 'asc' ? 1 : -1;
    out = [...out].sort((a, b) => {
      const av = a[field] as number | null;
      const bv = b[field] as number | null;
      if (av == null && bv == null) {
        return 0;
      }
      if (av == null) {
        return 1;
      } // nulls last regardless of direction
      if (bv == null) {
        return -1;
      }
      return (av - bv) * sign;
    });
  }

  const limit = Math.min(spec.limit ?? DEFAULT_LIMIT, 200);
  return { total, rows: out.slice(0, limit) };
}
