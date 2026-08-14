import { describe, expect, it } from 'vitest';
import { loadResearchSkillTool } from './load-research-skill.js';

describe('loadResearchSkill', () => {
  it('loads concept ids and explicit non-substitution rules', async () => {
    const result = await loadResearchSkillTool.run({ skillId: 'gold_price_drivers' });
    const observation = JSON.parse(result.observation) as {
      registryVersion: number;
      skill: {
        concepts: Array<{ conceptId: string; commonTransform?: string }>;
        rules: string[];
      };
      conceptDefinitions: Array<{ id: string }>;
    };

    expect(observation.registryVersion).toBe(1);
    expect(observation.skill.concepts.map((concept) => concept.conceptId)).toContain(
      'commodity.gold.price',
    );
    expect(observation.skill.rules.join(' ')).toContain('Do not replace DXY with USD/CNH');
    expect(
      observation.skill.concepts.find((concept) => concept.conceptId === 'rates.us_treasury.real')
        ?.commonTransform,
    ).toBe('difference');
    expect(observation.skill.rules.join(' ')).toContain(
      'rates.yield_pct does not register simple_return',
    );
    expect(observation.conceptDefinitions.map((concept) => concept.id)).toContain(
      'rates.us_treasury.real',
    );
  });
});
