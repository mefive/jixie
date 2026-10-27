import { expect, it } from 'vitest';
import { factorAnalysisSpecSchema } from '@jixie/shared/api/factor';
import { RESEARCH_SDK_CONTRACT_V1, SDK_ENTRIES } from '@jixie/shared';
import { createDefaultFactorAnalysisSpecV6 } from '../analysis/spec.js';
import { isRetiredFactorReport, reportResearchSpec } from './report-spec.js';

const base = createDefaultFactorAnalysisSpecV6({
  freq: 'month',
  start: '20200101',
  end: '20250101',
  neutral: 'size',
});

it.each([
  { ...base, neutral: 'size_industry' },
  { ...base, evaluationScope: { ...base.evaluationScope, rankingScope: 'within_industry' } },
  { ...base, evaluationScope: { ...base.evaluationScope, diagnostics: ['industry'] } },
])('rejects retired industry settings without substituting a supported protocol', (spec) => {
  expect(() => factorAnalysisSpecSchema.parse(spec)).toThrow();
  const row = {
    specJson: JSON.stringify(spec),
    neutral: 'none',
    freq: 'month',
    start: base.start,
    end: base.end,
  };
  const before = structuredClone(row);
  expect(isRetiredFactorReport(row)).toBe(true);
  expect(() => reportResearchSpec(row)).toThrow();
  expect(row).toEqual(before);
});

it('rejects old column-only industry reports while retaining size-neutral specifications', () => {
  const row = {
    specJson: null,
    neutral: 'size_industry',
    freq: 'month',
    start: base.start,
    end: base.end,
  };
  expect(() => reportResearchSpec(row)).toThrow();
  expect(reportResearchSpec({ ...row, neutral: 'size' })).toMatchObject({
    protocol: { neutral: 'size' },
  });
  expect(factorAnalysisSpecSchema.parse(base)).toEqual(base);
});

it('removes industry from Strategy methods and Research frame contracts', () => {
  expect(SDK_ENTRIES.some((entry) => (entry.name as string) === 'industry')).toBe(false);
  for (const method of RESEARCH_SDK_CONTRACT_V1.functions) {
    if (method.returns.kind === 'dataframe') {
      expect(
        method.returns.columns.some((column) => String(column.name) === 'industry'),
        method.qualifiedName,
      ).toBe(false);
    }
  }
});
