import { describe, expect, it } from 'vitest';
import { researchProfile } from './research.js';

describe('researchProfile', () => {
  it('exposes only semantic discovery and deterministic research execution', () => {
    const profile = researchProfile();
    const names = (profile.tools ?? []).map((tool) => tool.name);

    expect(names).toEqual([
      'loadResearchPlaybook',
      'searchResearchCatalog',
      'runUniverse',
      'executeResearchPlan',
    ]);
    expect(names).not.toContain('sqlQuery');
    expect(names).not.toContain('analyzeData');
    expect(names).not.toContain('renderChart');
  });

  it('requires catalog resolution and refuses unsupported approximation', () => {
    const { system } = researchProfile();

    expect(system).toContain('searchResearchCatalog');
    expect(system).toContain('executeResearchPlan');
    expect(system).toContain('loadResearchPlaybook');
    expect(system).toContain('gold_price_drivers');
    expect(system).toContain('pass its exact concept ids to searchResearchCatalog');
    expect(system).toContain('Playbooks contain research strategy, not database entities');
    expect(system).toContain('never apply one transform to both series merely for symmetry');
    expect(system).toContain('no_registered_binding');
    expect(system).toContain('registered_binding_no_data');
    expect(system).toContain('copy those ids, versions, units, and transforms');
    expect(system).toContain('The current date is');
    expect(system).toContain('do not approximate it with a different question');
    expect(system).toContain('why did gold rise');
    expect(system).toContain('concise fenced Python teaching example');
    expect(system).toContain('illustrative and not executed');
    expect(system).toContain(
      'Formal research conclusions must still come only from executeResearchPlan',
    );
    expect(system).toContain('Correlation is not causation');
  });
});
