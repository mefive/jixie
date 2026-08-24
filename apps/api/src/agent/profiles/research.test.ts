import { describe, expect, it, vi } from 'vitest';
import type { AgentTool } from '../tools/types.js';
import { researchProfile } from './research.js';

describe('researchProfile', () => {
  it('exposes semantic discovery and universe resolution without fixed protocol execution', () => {
    const profile = researchProfile();
    const names = (profile.tools ?? []).map((tool) => tool.name);

    expect(names).toEqual(['loadResearchPlaybook', 'searchResearchCatalog', 'runUniverse']);
    expect(names).not.toContain('sqlQuery');
    expect(names).not.toContain('analyzeData');
    expect(names).not.toContain('renderChart');
  });

  it('requires catalog resolution and refuses unsupported approximation', () => {
    const { system } = researchProfile();

    expect(system).toContain('searchResearchCatalog');
    expect(system).toContain('loadResearchPlaybook');
    expect(system).toContain('gold_price_drivers');
    expect(system).toContain('Markdown and Python Cells');
    expect(system).toContain('estimand, null hypothesis, formula');
    expect(system).toContain('SciPy and statsmodels');
    expect(system).toContain('data.series');
    expect(system).toContain('data.cross_section');
    expect(system).toContain('data.panel');
    expect(system).toContain('exact qualified SDK method name');
    expect(system).toContain('sdkMethods');
    expect(system).toContain('never infer an SDK signature or DataFrame column from memory');
    expect(system).toContain('not a replacement for FactorReport');
    expect(system).toContain('charts.*');
    expect(system).toContain('one focal predictor');
    expect(system).toContain('keep controls prespecified');
    expect(system).toContain('never invent or silently substitute data');
    expect(system).toContain('complete, controlled Research Concept vocabulary');
    expect(system).toContain('commodity.gold.price');
    expect(system).toContain('searchResearchCatalog.conceptRequests');
    expect(system).toContain('wait for explicit user confirmation');
    expect(system).toContain('The current date is');
    expect(system).toContain('Never claim a Cell ran');
    expect(system).toContain('ResearchExecution');
    expect(system).toContain('Correlation is not causation');
  });

  it('offers an editable-review Cell proposal tool only with a document snapshot', () => {
    const proposalTool: AgentTool = {
      name: 'proposeResearchCellChanges',
      description: 'test',
      parameters: { type: 'object', properties: {} },
      run: vi.fn(async () => ({ observation: '{}' })),
    };
    const profile = researchProfile('{"documentId":"document-1"}', proposalTool);

    expect(profile.tools?.map((tool) => tool.name)).toContain('proposeResearchCellChanges');
    expect(profile.system).toContain('only when the user explicitly asks to change the document');
    expect(profile.system).toContain('call proposeResearchCellChanges at most once');
    expect(profile.system).toContain('Markdown for the question, hypothesis');
    expect(profile.system).toContain('Python for platform data access');
    expect(profile.system).toContain('never claim that code ran or that the user accepted');
  });
});
