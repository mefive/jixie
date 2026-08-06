import type { FactorReport } from '@jixie/shared';
import { describe, expect, it, vi } from 'vitest';
import { CrossSectionalEvaluator, factorEvaluatorFor } from './evaluator.js';
import { createDefaultFactorAnalysisSpecV5 } from './report-spec.js';

const protocol = createDefaultFactorAnalysisSpecV5({
  freq: 'month',
  start: '20200101',
  end: '20250101',
  neutral: 'none',
});

describe('factor evaluator registry', () => {
  it('forwards the frozen cross-sectional protocol without transforming it', async () => {
    const report = { factor: 'ep' } as FactorReport;
    const analyze = vi.fn(async () => report);
    const evaluator = new CrossSectionalEvaluator(analyze);

    await expect(
      evaluator.evaluate({
        factor: 'ep',
        researchSpec: { version: 1, analysisKind: 'cross_sectional', protocol },
        source: { kind: 'single', code: 'code', label: 'EP' },
        locale: 'zh',
        onSystemLog: () => {},
        onUserLog: () => {},
      }),
    ).resolves.toBe(report);
    expect(analyze).toHaveBeenCalledWith(
      'ep',
      protocol,
      expect.any(Function),
      expect.any(Function),
      'zh',
      { kind: 'single', code: 'code', label: 'EP' },
    );
  });

  it('fails closed for evaluators that are only contractual', () => {
    expect(() =>
      factorEvaluatorFor({
        version: 1,
        analysisKind: 'time_series',
        start: '20200101',
        end: '20250101',
        observationFrequency: 'daily',
        assets: ['511260.SH'],
        target: { kind: 'forward_total_return', horizon: 20, horizonUnit: 'trade_day' },
        dataPolicy: { pointInTime: true, revisionPolicy: 'as_available', dataCutoff: null },
        inference: { standardError: 'newey_west', lag: 'automatic' },
      }),
    ).toThrow(/time_series/);
  });
});
