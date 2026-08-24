import { describe, expect, it } from 'vitest';
import { researchCapabilityCatalog } from './catalog.js';
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
    expect(researchConceptBindings('macro.inflation.us.cpi.headline')).toHaveLength(1);
    expect(researchConceptBindings('risk.market_stress.vix')).toEqual([]);
    expect(researchConceptBindings('flows.central_bank.gold_reserves')).toEqual([]);
  });

  it('binds headline US CPI only to the exact BLS index level', () => {
    expect(researchConceptBindings('macro.inflation.us.cpi.headline')).toEqual([
      expect.objectContaining({
        source: { kind: 'macro', seriesKey: 'us_cpi_u_all_items_nsa' },
        measure: 'macro.observation',
        contract: expect.objectContaining({
          id: 'us.macro.cpi.monthly.pit',
          version: 1,
          unit: 'index_1982_1984_100',
        }),
      }),
    ]);
  });

  it('derives every binding contract from the cross-market registry', () => {
    expect(
      researchConceptBindings('commodity.gold.price').map((binding) => binding.contract.id),
    ).toEqual(
      expect.arrayContaining([
        'cn.commodity_future.continuous.daily',
        'cn.etf.adjusted_close.daily',
      ]),
    );
    expect(
      researchConceptBindings('rates.us_treasury.nominal').every(
        (binding) => binding.contract.id === 'us.sovereign_yield.daily',
      ),
    ).toBe(true);
    expect(researchConceptBindings('equity.market.hk.benchmark')).toEqual([
      expect.objectContaining({
        source: { kind: 'instrument', assetType: 'index', id: 'equity.hk.hsi.price' },
        measure: 'market.adjusted_close',
        contract: expect.objectContaining({ id: 'hk.equity_benchmark.price.daily' }),
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

  it('describes material proxy dimensions instead of treating broad concepts as exact identity', () => {
    expect(researchConceptBindings('commodity.gold.price')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: { kind: 'instrument', assetType: 'future', id: 'AU.SHF' },
          proxyKind: 'approved_proxy',
          dimensions: {
            instrumentForm: 'continuous_future',
            quoteCurrency: 'CNY',
            market: 'CN',
          },
        }),
      ]),
    );
    expect(researchConceptBindings('rates.us_treasury.real')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dimensions: { instrumentForm: 'yield_curve', market: 'US', termYears: 10 },
        }),
      ]),
    );
  });

  it('distinguishes local bindings from bindings executable through the public Research SDK', () => {
    const goldFuture = researchConceptBindings('commodity.gold.price')[0]!;
    const realYield = researchConceptBindings('rates.us_treasury.real')[0]!;

    expect(researchConceptBindingSdkCall(goldFuture)).toEqual({
      method: 'data.series',
      assetType: 'future',
      identifier: 'AU.SHF',
      measure: 'market.adjusted_close',
    });
    expect(researchConceptBindingSdkCall(realYield)).toBeNull();
  });
});
