import { describe, expect, it } from 'vitest';
import { summarizeFactorInputs } from './factor-inputs.js';

const release = {
  releaseId: '01KZZZZZZZZZZZZZZZZZZZZZZZ',
  sourceId: 'factor-1',
  releaseKey: 'ep',
  version: 1,
  codeHash: 'abc123',
  approvedReportId: 'report-1',
  maturity: 'production' as const,
};

describe('factor input summaries', () => {
  it('summarizes all final-bar reads and retains decision-asset values', () => {
    const summaries = summarizeFactorInputs(
      [release],
      '20260805',
      [
        { key: `release:${release.releaseId}`, code: 'B', value: null },
        { key: `release:${release.releaseId}`, code: 'A', value: 1 },
        { key: `release:${release.releaseId}`, code: 'C', value: 3 },
      ],
      ['C', 'A'],
    );

    expect(summaries).toEqual([
      {
        releaseId: release.releaseId,
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

  it('keeps a release trace even when the strategy never reads it', () => {
    expect(summarizeFactorInputs([release], '20260805', [], [])).toEqual([
      expect.objectContaining({
        releaseId: release.releaseId,
        observedAssets: 0,
        validAssets: 0,
        meanValue: null,
        decisionObservations: [],
      }),
    ]);
  });
});
