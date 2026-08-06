import { describe, expect, it } from 'vitest';
import {
  assertFactorReleaseDependencies,
  factorReleaseDependenciesFromJson,
} from './factor-release-lineage.js';

const dependency = {
  releaseId: '01KZZZZZZZZZZZZZZZZZZZZZZZ',
  sourceId: 'factor-1',
  releaseKey: 'ep',
  version: 1,
  codeHash: 'abc123',
  approvedReportId: 'report-1',
  maturity: 'production' as const,
};

describe('factor release signal lineage', () => {
  it('parses valid dependency snapshots and preserves legacy null rows', () => {
    expect(factorReleaseDependenciesFromJson([dependency])).toEqual([dependency]);
    expect(factorReleaseDependenciesFromJson(null)).toBeNull();
  });

  it('rejects malformed snapshots', () => {
    expect(() => factorReleaseDependenciesFromJson({ ...dependency })).toThrow(
      'Invalid factor release dependency snapshot',
    );
    expect(() => factorReleaseDependenciesFromJson([{ ...dependency, version: 0 }])).toThrow(
      'Invalid factor release dependency snapshot',
    );
  });

  it('detects dependency drift independent of source order', () => {
    expect(() => assertFactorReleaseDependencies([dependency], [dependency])).not.toThrow();
    expect(() =>
      assertFactorReleaseDependencies([dependency], [{ ...dependency, codeHash: 'changed' }]),
    ).toThrow('Factor release dependency snapshot mismatch');
    expect(() => assertFactorReleaseDependencies(null, [dependency])).not.toThrow();
  });
});
