import { describe, expect, it } from 'vitest';
import { summarizeFactorInputs } from './factor-inputs.js';

const factor = {
  factorId: 'factor-1',
  key: 'ep',
  name: 'EP',
  analysisKind: 'cross_sectional' as const,
  codeHash: 'abc123',
  approvedReportId: 'report-1',
};

describe('factor input summaries', () => {
  it('summarizes all final-bar reads and retains decision-asset values', () => {
    const summaries = summarizeFactorInputs(
      [factor],
      '20260805',
      [
        { key: factor.key, code: 'B', value: null },
        { key: factor.key, code: 'A', value: 1 },
        { key: factor.key, code: 'C', value: 3 },
      ],
      ['C', 'A'],
    );

    expect(summaries).toEqual([
      {
        factorId: factor.factorId,
        key: factor.key,
        asOfDate: '20260805',
        observedAssets: 3,
        validAssets: 2,
        minValue: 1,
        maxValue: 3,
        meanValue: 2,
        decisionObservations: [
          { assetId: 'A', value: 1 },
          { assetId: 'C', value: 3 },
        ],
      },
    ]);
  });

  it('keeps a factor trace even when the strategy never reads it', () => {
    expect(summarizeFactorInputs([factor], '20260805', [], [])).toEqual([
      expect.objectContaining({
        factorId: factor.factorId,
        key: factor.key,
        observedAssets: 0,
        validAssets: 0,
        meanValue: null,
        decisionObservations: [],
      }),
    ]);
  });
});
