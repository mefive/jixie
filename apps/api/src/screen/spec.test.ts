import { describe, expect, it } from 'vitest';
import type { ScreenRow } from '@jixie/shared';
import { applyScreen, validateScreenSpec } from './spec.js';

const row = (
  tsCode: string,
  pe: number | null,
  dvRatio: number | null,
  totalMv: number,
): ScreenRow => ({
  tsCode,
  name: tsCode,
  industry: null,
  tradeDate: '20241231',
  close: 10,
  pctChg: 0,
  pe,
  peTtm: pe,
  pb: 1,
  ps: 1,
  dvRatio,
  totalMv,
  circMv: totalMv,
  turnoverRate: 1,
});

const rows: ScreenRow[] = [
  row('A', 8, 3, 100),
  row('B', 15, 1, 500),
  row('C', null, 5, 200), // missing pe
  row('D', 12, 2, 300),
];

describe('applyScreen', () => {
  it('filters by predicate (missing value never passes)', () => {
    const { total, rows: out } = applyScreen(rows, {
      filters: [{ field: 'pe', op: '<', value: 13 }],
    });
    expect(total).toBe(2); // A(8), D(12) — C(null) excluded, B(15) excluded
    expect(out.map((r) => r.tsCode).sort()).toEqual(['A', 'D']);
  });

  it('sorts (nulls last) and limits', () => {
    const { rows: out } = applyScreen(rows, {
      filters: [],
      sort: { field: 'pe', dir: 'asc' },
      limit: 3,
    });
    expect(out.map((r) => r.tsCode)).toEqual(['A', 'D', 'B']); // 8,12,15 then C(null) dropped by limit
  });

  it('descending sort', () => {
    const { rows: out } = applyScreen(rows, {
      filters: [],
      sort: { field: 'totalMv', dir: 'desc' },
    });
    expect(out.map((r) => r.tsCode)).toEqual(['B', 'D', 'C', 'A']); // 500,300,200,100
  });

  it('combined filter + sort', () => {
    const { rows: out } = applyScreen(rows, {
      filters: [{ field: 'dvRatio', op: '>=', value: 2 }],
      sort: { field: 'dvRatio', dir: 'desc' },
    });
    expect(out.map((r) => r.tsCode)).toEqual(['C', 'A', 'D']); // dv 5,3,2
  });
});

describe('validateScreenSpec', () => {
  it('accepts a valid spec', () => {
    const r = validateScreenSpec({ filters: [{ field: 'pe', op: '<', value: 20 }], limit: 30 });
    expect(r.ok).toBe(true);
  });
  it('rejects unknown field', () => {
    const r = validateScreenSpec({ filters: [{ field: 'roe', op: '<', value: 20 }] });
    expect(r.ok).toBe(false);
  });
  it('rejects bad op', () => {
    const r = validateScreenSpec({ filters: [{ field: 'pe', op: '==', value: 20 }] });
    expect(r.ok).toBe(false);
  });
});
