import { describe, expect, it, vi } from 'vitest';
import type { AgentTool } from '../tools/types.js';
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
    expect(system).toContain('multivariate_time_series_relationship');
    expect(system).toContain('exactly one focal predictor');
    expect(system).toContain('keep all variables regardless of resulting significance');
    expect(system).toContain('no_registered_binding');
    expect(system).toContain('registered_binding_no_data');
    expect(system).toContain('blocked_by_source_rights');
    expect(system).toContain('sourceDecisions');
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

  it('offers a review-only Cell proposal tool only with a document snapshot', () => {
    const proposalTool: AgentTool = {
      name: 'proposeResearchCellChanges',
      description: 'test',
      parameters: { type: 'object', properties: {} },
      run: vi.fn(async () => ({ observation: '{}' })),
    };
    const profile = researchProfile('{"documentId":"document-1"}', proposalTool);

    expect(profile.tools?.map((tool) => tool.name)).toContain('proposeResearchCellChanges');
    expect(profile.system).toContain('only when the user explicitly asks to change this document');
    expect(profile.system).toContain('pending review artifact');
    expect(profile.system).toContain(
      'Never claim that a proposal changed the document or ran code',
    );
  });
});
