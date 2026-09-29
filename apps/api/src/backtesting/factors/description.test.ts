import { describe, expect, it } from 'vitest';
import { describeFactors } from './description.js';
import type { FactorDefinition } from './execution-port.js';

describe('factor description', () => {
  it('aggregates data requirements and deduplicates codes without exposing sources', () => {
    const description = describeFactors([
      { id: 'history', kind: 'cross_sectional', historyFields: ['turnoverRateF', 'roe'] },
      {
        id: 'rates',
        kind: 'asset_series',
        analysisKind: 'panel',
        meta: { window: 2, inputs: ['rates.cgb.yield.10y'] },
        assetUniverse: [{ assetId: 'BOND', assetClass: 'fixed_income' }],
      },
      {
        id: 'composite',
        kind: 'panel_composite',
        standardization: 'rank',
        components: [],
        assetUniverse: [{ assetId: 'BOND', assetClass: 'fixed_income' }],
      },
    ]);

    expect(description.preloadCodes).toEqual(['BOND']);
    expect(description.dataRequirements).toEqual({
      turnoverRateFHistory: true,
      fundamentalHistory: true,
      governmentYieldCurve: true,
    });
    expect(describeFactors([])).toEqual({
      definitions: [],
      preloadCodes: [],
      assetClassByCode: new Map(),
      dataRequirements: {
        turnoverRateFHistory: false,
        fundamentalHistory: false,
        governmentYieldCurve: false,
      },
    });
  });

  it('takes the approved panel universe as the authoritative asset taxonomy', () => {
    const modules: FactorDefinition[] = [
      {
        id: 'allocation_panel',
        kind: 'panel_composite',
        standardization: 'rank',
        assetUniverse: [
          { assetId: 'EQUITY', assetClass: 'cn_equity' },
          { assetId: 'BOND', assetClass: 'fixed_income' },
        ],
        components: [],
      },
    ];
    expect([...describeFactors(modules).assetClassByCode]).toEqual([
      ['EQUITY', 'cn_equity'],
      ['BOND', 'fixed_income'],
    ]);
  });

  it('retains the approved asset taxonomy for a single panel factor', () => {
    const definitions: FactorDefinition[] = [
      {
        id: 'panel',
        kind: 'asset_series',
        analysisKind: 'panel',
        meta: { window: 2, inputs: ['etf.adjustedClose'] },
        assetUniverse: [{ assetId: 'BOND', assetClass: 'fixed_income' }],
      },
    ];
    expect([...describeFactors(definitions).assetClassByCode]).toEqual([['BOND', 'fixed_income']]);
  });

  it('rejects conflicting asset classes instead of silently misclassifying exposure', () => {
    const modules: FactorDefinition[] = [
      panelDefinition('first', 'cn_equity'),
      panelDefinition('second', 'fixed_income'),
    ];
    expect(() => describeFactors(modules).assetClassByCode).toThrow(
      'conflicting asset classes for ETF',
    );
  });
});

function panelDefinition(key: string, assetClass: 'cn_equity' | 'fixed_income'): FactorDefinition {
  return {
    id: key,
    kind: 'panel_composite',
    standardization: 'rank',
    assetUniverse: [{ assetId: 'ETF', assetClass }],
    components: [],
  };
}
