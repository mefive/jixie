import { describe, expect, it } from 'vitest';
import {
  StockNameLookup,
  canonicalStockCode,
  classifyStockName,
  normalizeStockNameSpells,
} from './stock-identity.js';

describe('stock identity', () => {
  it('canonicalizes exchange-confirmed historical aliases', () => {
    expect(canonicalStockCode('000022.SZ')).toBe('001872.SZ');
    expect(canonicalStockCode('000043.SZ')).toBe('001914.SZ');
    expect(canonicalStockCode('300114.SZ')).toBe('302132.SZ');
    expect(canonicalStockCode('600519.SH')).toBe('600519.SH');
  });

  it.each(['ST测试', '*ST测试', 'SST测试', 'S*ST测试', 'PT测试'])(
    'classifies %s as a risk-warning name',
    (name) => {
      expect(classifyStockName(name)).toEqual({
        name,
        riskWarning: true,
        pendingDelisting: false,
      });
    },
  );

  it.each(['测试退', '退市测试'])('classifies %s as a delisting-period name', (name) => {
    expect(classifyStockName(name)).toEqual({
      name,
      riskWarning: false,
      pendingDelisting: true,
    });
  });

  it('performs inclusive point-in-time lookup and resolves old codes', () => {
    const lookup = new StockNameLookup([
      {
        tsCode: '302132.SZ',
        name: 'ST中航',
        startDate: '20240101',
        endDate: '20241231',
      },
      {
        tsCode: '302132.SZ',
        name: '中航成飞',
        startDate: '20250101',
        endDate: null,
      },
    ]);

    expect(lookup.at('300114.SZ', '20241231').riskWarning).toBe(true);
    expect(lookup.at('302132.SZ', '20250101')).toEqual({
      name: '中航成飞',
      riskWarning: false,
      pendingDelisting: false,
    });
    expect(lookup.at('302132.SZ', '20230101').name).toBeNull();
  });

  it('drops redundant same-name overlaps and closes the preceding spell', () => {
    expect(
      normalizeStockNameSpells([
        {
          tsCode: '600676.SH',
          name: '交运股份',
          startDate: '20061009',
          endDate: '20260727',
        },
        {
          tsCode: '600676.SH',
          name: '久事动娱',
          startDate: '20260617',
          endDate: null,
        },
        {
          tsCode: '600676.SH',
          name: '久事动娱',
          startDate: '20260728',
          endDate: null,
        },
      ]),
    ).toEqual([
      {
        tsCode: '600676.SH',
        name: '交运股份',
        startDate: '20061009',
        endDate: '20260727',
      },
      {
        tsCode: '600676.SH',
        name: '久事动娱',
        startDate: '20260728',
        endDate: null,
      },
    ]);
  });
});
