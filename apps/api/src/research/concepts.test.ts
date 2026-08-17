import { describe, expect, it } from 'vitest';
import { inferResearchConceptIds, researchConceptRegistry } from './concepts.js';
import { researchPlaybookRegistry } from './playbooks.js';

describe('research concept registry', () => {
  it('resolves domain wording without guessing a database entity', () => {
    expect(inferResearchConceptIds('黄金的涨跌逻辑')).toContain('commodity.gold.price');
    expect(inferResearchConceptIds('real treasury yield')).toEqual(['rates.us_treasury.real']);
    expect(inferResearchConceptIds('treasury yield real')).toEqual(['rates.us_treasury.real']);
    expect(inferResearchConceptIds('USDCNH')).not.toContain('fx.usd_strength.dxy');
    expect(inferResearchConceptIds('美国 CPI')).toEqual(['macro.inflation.us.cpi.headline']);
    expect(inferResearchConceptIds('恒生指数人民币收益')).toContain('equity.market.hk.benchmark');
    expect(inferResearchConceptIds('标普500和沪深300')).toEqual(
      expect.arrayContaining(['equity.market.us.benchmark', 'equity.market.cn.benchmark']),
    );
  });

  it('keeps every playbook concept reference inside the versioned registry', () => {
    const conceptIds = new Set(researchConceptRegistry.concepts.map((concept) => concept.id));
    const referenced = researchPlaybookRegistry.playbooks.flatMap((playbook) =>
      playbook.concepts.map((concept) => concept.conceptId),
    );

    expect(new Set(conceptIds).size).toBe(researchConceptRegistry.concepts.length);
    expect(referenced.every((conceptId) => conceptIds.has(conceptId))).toBe(true);
  });
});
