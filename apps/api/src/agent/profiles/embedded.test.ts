import { describe, expect, it } from 'vitest';
import type { FactorQuestionContextV1 } from '@jixie/shared';
import { factorProfile } from './factor.js';
import { strategyProfile } from './strategy.js';
import { factorQaProfile } from './qa.js';
import { researchProfile } from './research.js';
import { withEmbeddedAnalysis } from './embedded.js';

const questionContext: FactorQuestionContextV1 = {
  version: 1,
  capturedAt: '2026-09-14T00:00:00Z',
  factor: {
    key: 'ep',
    name: 'Earnings yield',
    kind: 'factor',
    analysisKind: 'cross_sectional',
    language: 'typescript',
    source: 'definition',
    sourceHash: 'hash',
  },
  report: null,
};

describe('calculation tool boundaries', () => {
  const profiles = [
    ['TypeScript Strategy', strategyProfile()],
    ['Python Strategy and Research handoff', strategyProfile(undefined, undefined, 'python')],
    ['Factor authoring', factorProfile()],
    ['read-only Factor questions', factorQaProfile(questionContext)],
  ] as const;

  it.each(profiles)('%s adds persisted analysis only with a page context', (_name, profile) => {
    expect(profile.tools?.map((tool) => tool.name)).toEqual([
      'searchInstruments',
      'dataCoverage',
      'runUniverse',
      'sqlQuery',
    ]);
    const pageProfile = withEmbeddedAnalysis(profile, {
      userId: 'owner',
      source: {
        host: { type: 'factor', id: 'ep' },
        name: 'Earnings yield',
        code: 'definition',
        codeHash: 'hash',
        language: 'typescript',
        capturedAt: questionContext.capturedAt,
      },
    });
    const names = pageProfile.tools!.map((tool) => tool.name);
    expect(names).toEqual([
      ...profile.tools!.map((tool) => tool.name),
      'searchResearchCatalog',
      'runEmbeddedAnalysis',
      'readEmbeddedAnalysis',
    ]);
    expect(new Set(names).size).toBe(names.length);
    for (const retired of ['analyzeData', 'renderChart', 'renderComputedChart']) {
      expect(pageProfile.system).not.toContain(retired);
      expect(profile.system).not.toContain(retired);
    }
  });

  it('keeps the Research document workflow separate from embedded execution', () => {
    const names = researchProfile().tools!.map((tool) => tool.name);
    expect(names).not.toContain('runEmbeddedAnalysis');
    expect(names).not.toContain('readEmbeddedAnalysis');
    expect(names).not.toContain('analyzeData');
    expect(names).not.toContain('renderChart');
    expect(names).not.toContain('renderComputedChart');
  });
});
