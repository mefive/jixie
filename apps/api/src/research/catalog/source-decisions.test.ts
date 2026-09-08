import { describe, expect, it } from 'vitest';
import { researchConceptBindings } from './concept-bindings.js';
import { researchSourceDecisionRegistry, researchSourceDecisions } from './source-decisions.js';

describe('researchSourceDecisionRegistry', () => {
  it('keeps reviewed source-rights blocks explicit and evidence-backed', () => {
    const ids = researchSourceDecisionRegistry.decisions.map((decision) => decision.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const conceptId of ['fx.usd_strength.dxy', 'risk.market_stress.vix'] as const) {
      expect(researchConceptBindings(conceptId)).toEqual([]);
      const decisions = researchSourceDecisions(conceptId);
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({ status: 'blocked_external_license' });
      expect(decisions[0]!.evidence.some((evidence) => evidence.kind === 'usage_rights')).toBe(
        true,
      );
    }
  });
});
