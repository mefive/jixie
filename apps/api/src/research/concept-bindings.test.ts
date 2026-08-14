import { describe, expect, it } from 'vitest';
import { researchCapabilityCatalog } from './catalog.js';
import { researchConceptBindingRegistry, researchConceptBindings } from './concept-bindings.js';
import { researchConceptById } from './concepts.js';

describe('researchConceptBindingRegistry', () => {
  it('contains unique, executable allow-list bindings', () => {
    const ids = researchConceptBindingRegistry.bindings.map((binding) => binding.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const binding of researchConceptBindingRegistry.bindings) {
      expect(researchConceptById.has(binding.conceptId)).toBe(true);
      const measure = researchCapabilityCatalog.measures.find(
        (candidate) => candidate.id === binding.measure,
      );
      expect(measure?.sourceKinds).toContain(binding.source.kind);
      if (binding.source.kind === 'instrument') {
        expect(measure?.assetTypes).toContain(binding.source.assetType);
      }
    }
  });

  it('keeps exact missing concepts unbound instead of substituting related data', () => {
    expect(researchConceptBindings('fx.usd_strength.dxy')).toEqual([]);
    expect(researchConceptBindings('macro.inflation.us')).toEqual([]);
    expect(researchConceptBindings('macro.inflation.us.cpi.headline')).toHaveLength(1);
    expect(researchConceptBindings('risk.market_stress.vix')).toEqual([]);
    expect(researchConceptBindings('flows.central_bank.gold_reserves')).toEqual([]);
  });

  it('binds headline US CPI only to the exact BLS index level', () => {
    expect(researchConceptBindings('macro.inflation.us.cpi.headline')).toEqual([
      expect.objectContaining({
        source: { kind: 'macro', seriesKey: 'us_cpi_u_all_items_nsa' },
        measure: 'macro.observation',
        contract: expect.objectContaining({ unit: 'index_1982_1984_100' }),
      }),
    ]);
  });

  it('binds nominal and real yields only to their own exact curves', () => {
    expect(
      researchConceptBindings('rates.us_treasury.nominal').every(
        (binding) =>
          binding.source.kind === 'yield_curve' &&
          binding.source.curveCode === 'us_treasury_nominal',
      ),
    ).toBe(true);
    expect(
      researchConceptBindings('rates.us_treasury.real').every(
        (binding) =>
          binding.source.kind === 'yield_curve' && binding.source.curveCode === 'us_treasury_real',
      ),
    ).toBe(true);
  });
});
