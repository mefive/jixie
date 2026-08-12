import { describe, expect, it } from 'vitest';
import { createDefaultFactorAnalysisSpecV6 } from './report-spec.js';
import {
  buildCrossSectionalRobustInference,
  estimateFamaMacbethPeriod,
  type FamaMacbethCrossSectionRowV1,
} from './cross-sectional-inference.js';

const spec = createDefaultFactorAnalysisSpecV6({
  freq: 'month',
  start: '20200101',
  end: '20251231',
  neutral: 'none',
});

function crossSection(size = 120): FamaMacbethCrossSectionRowV1[] {
  return Array.from({ length: size }, (_, index) => {
    const candidate = (index % 13) - 6;
    const marketSize = Math.log(index + 10);
    const value = ((index * 7) % 17) - 8;
    const momentum = Math.sin(index / 7);
    const quality = Math.cos(index / 11);
    return {
      candidate,
      size: marketSize,
      value,
      momentum,
      quality,
      forwardReturn:
        0.01 * candidate + 0.002 * marketSize - 0.001 * value + 0.003 * momentum + 0.0015 * quality,
    };
  });
}

describe('cross-sectional robust inference', () => {
  it('estimates the candidate premium with the frozen four-control set', () => {
    const attempt = estimateFamaMacbethPeriod(crossSection(), 100);

    expect(attempt.collinear).toBe(false);
    expect(attempt.estimate?.observations).toBe(120);
    expect(attempt.estimate?.coefficient).toBeGreaterThan(0);
  });

  it('does not silently remove a control when the candidate is collinear', () => {
    const rows = crossSection().map((row) => ({ ...row, candidate: row.size }));
    const attempt = estimateFamaMacbethPeriod(rows, 100);

    expect(attempt).toMatchObject({ estimate: null, collinear: true });
  });

  it('attributes a noisy size proxy to the fixed size control', () => {
    const rows = crossSection().map((row, index) => ({
      ...row,
      candidate: row.size + Math.sin(index * 1.7) * 0.01,
      forwardReturn: row.size * 0.02,
    }));
    const attempt = estimateFamaMacbethPeriod(rows, 100);

    expect(attempt.collinear).toBe(false);
    expect(Math.abs(attempt.estimate!.coefficient)).toBeLessThan(1e-8);
  });

  it('requires twelve estimated periods before publishing Fama–MacBeth inference', () => {
    const attempt = estimateFamaMacbethPeriod(crossSection(), 100);
    const insufficient = buildCrossSectionalRobustInference({
      spec,
      rankIc: Array(11).fill(0.03),
      equalGross: Array(11).fill(0.01),
      equalNet: Array(11).fill(0.008),
      mktcapGross: Array(11).fill(0.009),
      mktcapNet: Array(11).fill(0.007),
      famaMacbethAttempts: Array(11).fill(attempt),
    });
    const available = buildCrossSectionalRobustInference({
      spec,
      rankIc: Array.from({ length: 12 }, (_, index) => 0.02 + index / 10_000),
      equalGross: Array.from({ length: 12 }, (_, index) => 0.01 + index / 10_000),
      equalNet: Array.from({ length: 12 }, (_, index) => 0.008 + index / 10_000),
      mktcapGross: Array.from({ length: 12 }, (_, index) => 0.009 + index / 10_000),
      mktcapNet: Array.from({ length: 12 }, (_, index) => 0.007 + index / 10_000),
      famaMacbethAttempts: Array(12).fill(attempt),
    });

    expect(insufficient.famaMacbeth).toMatchObject({
      status: 'unavailable',
      unavailableReason: 'insufficient_periods',
      periodsEstimated: 11,
    });
    expect(available.famaMacbeth.status).toBe('available');
    expect(available.famaMacbeth.candidateCoefficient?.observations).toBe(12);
  });
});
