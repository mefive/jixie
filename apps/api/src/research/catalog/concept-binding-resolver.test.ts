import { expect, it } from 'vitest';
import { researchBindingAllowed } from './concept-binding-resolver.js';
import { researchConceptBindings } from './concept-bindings.js';

it('keeps ETF concept bindings and respects asset filters', () => {
  const binding = researchConceptBindings('commodity.gold.price')[0]!;
  expect(researchBindingAllowed(binding, { assetTypes: ['etf'] })).toBe(true);
  expect(researchBindingAllowed(binding, { assetTypes: ['stock'] })).toBe(false);
});
