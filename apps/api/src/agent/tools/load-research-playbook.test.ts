import { describe, expect, it } from 'vitest';
import { loadResearchPlaybookTool } from './load-research-playbook.js';

describe('loadResearchPlaybook', () => {
  it('loads concept ids and explicit non-substitution rules', async () => {
    const result = await loadResearchPlaybookTool.run({ playbookId: 'gold_price_drivers' });
    const observation = JSON.parse(result.observation) as {
      registryVersion: number;
      playbook: {
        concepts: Array<{ conceptId: string; commonTransform?: string }>;
        rules: string[];
      };
      conceptDefinitions: Array<{ id: string }>;
    };

    expect(observation.registryVersion).toBe(1);
    expect(observation.playbook.concepts.map((concept) => concept.conceptId)).toContain(
      'commodity.gold.price',
    );
    expect(observation.playbook.rules.join(' ')).toContain('Do not replace DXY with USD/CNH');
    expect(
      observation.playbook.concepts.find(
        (concept) => concept.conceptId === 'rates.us_treasury.real',
      )?.commonTransform,
    ).toBe('difference');
    expect(observation.playbook.rules.join(' ')).toContain(
      'rates.yield_pct does not register simple_return',
    );
    expect(observation.conceptDefinitions.map((concept) => concept.id)).toContain(
      'rates.us_treasury.real',
    );
    expect(observation.playbook.concepts.map((concept) => concept.conceptId)).toContain(
      'macro.inflation.us.cpi.headline',
    );
  });
});
