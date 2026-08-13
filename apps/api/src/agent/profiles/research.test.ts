import { describe, expect, it } from 'vitest';
import { researchProfile } from './research.js';

describe('researchProfile', () => {
  it('exposes only semantic discovery and deterministic research execution', () => {
    const profile = researchProfile();
    const names = (profile.tools ?? []).map((tool) => tool.name);

    expect(names).toEqual(['searchResearchCatalog', 'runUniverse', 'executeResearchPlan']);
    expect(names).not.toContain('sqlQuery');
    expect(names).not.toContain('analyzeData');
    expect(names).not.toContain('renderChart');
  });

  it('requires catalog resolution and refuses unsupported approximation', () => {
    const { system } = researchProfile();

    expect(system).toContain('searchResearchCatalog');
    expect(system).toContain('executeResearchPlan');
    expect(system).toContain('copy its exact measure id');
    expect(system).toContain('The current date is');
    expect(system).toContain('do not approximate it with a different question');
    expect(system).toContain('Correlation is not causation');
  });
});
