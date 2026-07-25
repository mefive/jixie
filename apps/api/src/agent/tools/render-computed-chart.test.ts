import { describe, expect, it } from 'vitest';
import { runAnalysisCode } from './analyze-sandbox.js';
import { normalizeComputeChartRows } from './render-computed-chart.js';

const SPEC = { x: 'date', series: [{ column: 'value' }] };

describe('normalizeComputeChartRows', () => {
  it('accepts a plain row array and a { rows } wrapper', () => {
    const rows = [
      { date: '20240101', value: 1.5 },
      { date: '20240102', value: null },
    ];
    expect(normalizeComputeChartRows(rows, SPEC)).toEqual(rows);
    expect(normalizeComputeChartRows({ rows }, SPEC)).toEqual(rows);
  });

  it('converts bigint scalars for JSON transport', () => {
    expect(normalizeComputeChartRows([{ date: '20240101', value: 42n }], SPEC)).toEqual([
      { date: '20240101', value: 42 },
    ]);
  });

  it('rejects scalar results, empty tables, oversized tables, and nested rows', () => {
    expect(() => normalizeComputeChartRows({ corr: 0.6 }, SPEC)).toThrow(/ARRAY of flat row/);
    expect(() => normalizeComputeChartRows([], SPEC)).toThrow(/no rows/);
    const oversized = Array.from({ length: 501 }, (_value, index) => ({
      date: String(index),
      value: index,
    }));
    expect(() => normalizeComputeChartRows(oversized, SPEC)).toThrow(/cap 500/);
    expect(() =>
      normalizeComputeChartRows([{ date: '20240101', value: { nested: 1 } }], SPEC),
    ).toThrow(/not a scalar/);
  });

  it('rejects a mapping onto columns the rows do not have', () => {
    expect(() => normalizeComputeChartRows([{ date: '20240101', other: 1 }], SPEC)).toThrow(
      /no such columns: value/,
    );
  });

  it('draws a sandbox-computed series end to end (sans SQL)', async () => {
    const result = await runAnalysisCode(
      `export default ({ data, stats }) => data.px.slice(1).map((row, index) => ({
         date: row.d,
         ret: row.c / data.px[index].c - 1,
       }));`,
      {
        px: [
          { d: '20240101', c: 10 },
          { d: '20240102', c: 11 },
          { d: '20240103', c: 9.9 },
        ],
      },
    );
    const rows = normalizeComputeChartRows(result, { x: 'date', series: [{ column: 'ret' }] });
    expect(rows).toHaveLength(2);
    expect(rows[0].ret).toBeCloseTo(0.1, 12);
    expect(rows[1].ret).toBeCloseTo(-0.1, 12);
  });
});
