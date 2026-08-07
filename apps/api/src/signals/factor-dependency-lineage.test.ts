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
  });

  it('detects dependency drift independent of source order', () => {
    expect(() => assertFactorDependencies([dependency], [dependency])).not.toThrow();
    expect(() =>
      assertFactorDependencies([dependency], [{ ...dependency, codeHash: 'changed' }]),
    ).toThrow('Factor dependency snapshot mismatch');
    expect(() => assertFactorDependencies(null, [dependency])).not.toThrow();
  });
});
