import { describe, expect, it } from 'vitest';
import {
  interpretResearchCatalogQuery,
  researchCatalogTenorYears,
} from './search-research-catalog.js';

describe('research catalog query interpretation', () => {
  it('uses the concept registry for gold and preserves stable numeric instrument codes', () => {
    const interpretation = interpretResearchCatalogQuery({ text: '沪金 AU gold ETF 518880' });

    expect(interpretation.conceptIds).toContain('commodity.gold.price');
    expect(interpretation.terms).toEqual(
      expect.arrayContaining(['黄金', '沪金', 'AU', 'AU.SHF', '518880']),
    );
    expect(interpretResearchCatalogQuery({ text: '000300' }).terms).toContain('000300');
  });

  it('resolves English and Chinese yield tenors as structured filters', () => {
    expect(researchCatalogTenorYears('10 year treasury yield')).toBe(10);
    expect(researchCatalogTenorYears('美国十年期实际国债收益率')).toBe(10);
    expect(
      interpretResearchCatalogQuery({
        conceptIds: ['rates.us_treasury.real'],
        filters: { termYears: 20 },
      }).tenorYears,
    ).toBe(20);
  });

  it('keeps a DXY concept distinct from a generic USD pair', () => {
    const interpretation = interpretResearchCatalogQuery({ text: 'USD index dollar dxy' });

    expect(interpretation.conceptIds).toContain('fx.usd_strength.dxy');
    expect(interpretation.terms).toEqual(expect.arrayContaining(['美元指数', 'DXY']));
    expect(interpretation.terms).not.toContain('USD');
    expect(interpretation.terms).not.toContain('dollar');
    expect(interpretResearchCatalogQuery({ text: 'USDCNH' }).conceptIds).not.toContain(
      'fx.usd_strength.dxy',
    );
  });

  it('recognizes real-yield wording in either English order without selecting nominal yield', () => {
    expect(interpretResearchCatalogQuery({ text: 'treasury yield real' }).conceptIds).toEqual([
      'rates.us_treasury.real',
    ]);
    expect(interpretResearchCatalogQuery({ text: 'real treasury yield' }).conceptIds).toEqual([
      'rates.us_treasury.real',
    ]);
  });

  it('keeps skill-provided concepts explicit and independently searchable', () => {
    const interpretation = interpretResearchCatalogQuery({
      conceptIds: ['commodity.gold.price', 'macro.inflation.us', 'macro.inflation.cn'],
    });

    expect(interpretation.explicitConceptIds).toHaveLength(3);
    expect(interpretation.terms).toEqual(
      expect.arrayContaining(['AU.SHF', 'US CPI', 'cn_cpi_yoy']),
    );
  });
});
