import { describe, expect, it } from 'vitest';
import { researchCapabilityCatalog } from './capabilities.js';
import {
  researchConceptBindingRegistry,
  researchConceptBindingSdkCall,
  researchConceptBindings,
} from './concept-bindings.js';
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
    expect(researchConceptBindings('macro.inflation.us.cpi.headline')).toEqual([]);
    expect(researchConceptBindings('risk.market_stress.vix')).toEqual([]);
    expect(researchConceptBindings('flows.central_bank.gold_reserves')).toEqual([]);
  });

  it('derives every binding contract from the cross-market registry', () => {
    expect(
      researchConceptBindings('commodity.gold.price').map((binding) => binding.contract.id),
    ).toEqual(expect.arrayContaining(['cn.etf.adjusted_close.daily']));
    expect(researchConceptBindings('equity.market.hk.benchmark')).toEqual([]);
  });

  it('describes material proxy dimensions instead of treating broad concepts as exact identity', () => {
    expect(researchConceptBindings('commodity.gold.price')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: { kind: 'instrument', assetType: 'etf', id: '518880.SH' },
          proxyKind: 'approved_proxy',
          dimensions: {
            instrumentForm: 'etf',
            quoteCurrency: 'CNY',
            market: 'CN',
          },
        }),
      ]),
    );
    expect(researchConceptBindings('rates.us_treasury.real')).toEqual([]);
  });

  it('distinguishes local bindings from bindings executable through the public Research SDK', () => {
    const goldEtf = researchConceptBindings('commodity.gold.price')[0]!;

    expect(researchConceptBindingSdkCall(goldEtf)).toEqual({
      method: 'data.series',
      assetType: 'etf',
      identifier: '518880.SH',
      measure: 'market.adjusted_close',
    });
  });
});
