import { describe, expect, it } from 'vitest';
import { researchBindingAllowed } from './concept-binding-resolver.js';
import { researchConceptBindings } from './concept-bindings.js';

describe('researchBindingAllowed', () => {
  it('applies tenor filters only to yield-curve bindings', () => {
    const gold = researchConceptBindings('commodity.gold.price')[0]!;
    const realYields = researchConceptBindings('rates.us_treasury.real');
    const real5y = realYields.find(
      (binding) => binding.source.kind === 'yield_curve' && binding.source.termYears === 5,
    )!;
    const real10y = realYields.find(
      (binding) => binding.source.kind === 'yield_curve' && binding.source.termYears === 10,
    )!;

    expect(researchBindingAllowed(gold, { termYears: 10 })).toBe(true);
    expect(researchBindingAllowed(real5y, { termYears: 10 })).toBe(false);
    expect(researchBindingAllowed(real10y, { termYears: 10 })).toBe(true);
  });
});
