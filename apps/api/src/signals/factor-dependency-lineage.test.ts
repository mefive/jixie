import { describe, expect, it } from 'vitest';
import {
  assertFactorDependencies,
  factorDependenciesFromJson,
} from './factor-dependency-lineage.js';

const dependency = {
  factorId: 'factor-1',
  key: 'ep',
  name: 'EP',
  analysisKind: 'cross_sectional' as const,
  codeHash: 'abc123',
  approvedReportId: 'report-1',
};

describe('factor signal lineage', () => {
  it('parses valid dependency snapshots and preserves null rows', () => {
    expect(factorDependenciesFromJson([dependency])).toEqual([dependency]);
    expect(factorDependenciesFromJson(null)).toBeNull();
  });

  it('rejects malformed snapshots', () => {
    expect(() => factorDependenciesFromJson({ ...dependency })).toThrow(
      'Invalid factor dependency snapshot',
    );
    expect(() => factorDependenciesFromJson([{ ...dependency, key: '' }])).toThrow(
      'Invalid factor dependency snapshot',
    );
    expect(() => factorDependenciesFromJson([{ ...dependency, inputs: [''] }])).toThrow(
      'Invalid factor dependency snapshot',
    );
  });

  it('detects dependency drift independent of source order', () => {
    expect(() => assertFactorDependencies([dependency], [dependency])).not.toThrow();
    expect(() =>
      assertFactorDependencies([dependency], [{ ...dependency, codeHash: 'changed' }]),
    ).toThrow('Factor dependency snapshot mismatch');
    expect(() => assertFactorDependencies(null, [dependency])).not.toThrow();
  });

  it('freezes Definition V2 inputs independent of declaration order', () => {
    const expected = {
      ...dependency,
      analysisKind: 'time_series' as const,
      inputs: ['rates.cgb.yield.10y', 'rates.cgb.yield.2y'],
    };
    expect(() =>
      assertFactorDependencies(
        [expected],
        [{ ...expected, inputs: ['rates.cgb.yield.2y', 'rates.cgb.yield.10y'] }],
      ),
    ).not.toThrow();
    expect(() =>
      assertFactorDependencies([expected], [{ ...expected, inputs: ['rates.cgb.yield.10y'] }]),
    ).toThrow('Factor dependency snapshot mismatch');
  });
});
