import { describe, expect, it } from 'vitest';
import { inferResearchConceptIds, researchConceptRegistry } from './concepts.js';
import { researchSkillRegistry } from './skills.js';

describe('research concept registry', () => {
  it('resolves domain wording without guessing a database entity', () => {
    expect(inferResearchConceptIds('黄金的涨跌逻辑')).toContain('commodity.gold.price');
    expect(inferResearchConceptIds('real treasury yield')).toEqual(['rates.us_treasury.real']);
    expect(inferResearchConceptIds('treasury yield real')).toEqual(['rates.us_treasury.real']);
    expect(inferResearchConceptIds('USDCNH')).not.toContain('fx.usd_strength.dxy');
  });

  it('keeps every skill concept reference inside the versioned registry', () => {
    const conceptIds = new Set(researchConceptRegistry.concepts.map((concept) => concept.id));
    const referenced = researchSkillRegistry.skills.flatMap((skill) =>
      skill.concepts.map((concept) => concept.conceptId),
    );

    expect(new Set(conceptIds).size).toBe(researchConceptRegistry.concepts.length);
    expect(referenced.every((conceptId) => conceptIds.has(conceptId))).toBe(true);
  });
});
