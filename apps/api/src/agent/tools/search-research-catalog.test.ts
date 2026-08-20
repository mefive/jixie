import { describe, expect, it } from 'vitest';
import {
  interpretResearchCatalogQuery,
  researchCatalogTenorYears,
  researchSdkMethodsForCatalogQuery,
} from './search-research-catalog.js';

describe('research catalog query interpretation', () => {
  it('uses the concept registry for gold and limits lexical lookup to stable named identifiers', () => {
    const interpretation = interpretResearchCatalogQuery({ text: '沪金 AU gold ETF 518880' });

    expect(interpretation.conceptIds).toContain('commodity.gold.price');
    expect(interpretation.terms).toEqual(['518880']);
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
    expect(interpretation.terms).toEqual([]);
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

  it('keeps playbook-provided concepts explicit without turning them into database search terms', () => {
    const interpretation = interpretResearchCatalogQuery({
      conceptIds: ['commodity.gold.price', 'macro.inflation.us.cpi.headline', 'macro.inflation.cn'],
    });

    expect(interpretation.explicitConceptIds).toHaveLength(3);
    expect(interpretation.terms).toEqual([]);
  });

  it('resolves exact Research SDK method names without guessing a signature', () => {
    const [method] = researchSdkMethodsForCatalogQuery('Research SDK data.panel');

    expect(method?.qualifiedName).toBe('data.panel');
    expect(method?.signature).toBe(
      'data.panel(universe: str, *, start: str, end: str, frequency: Literal["month_end"] = "month_end", minimum_listed_days: int = 365, risk_warning: Literal["exclude", "include"] = "exclude") -> pd.DataFrame',
    );
    expect(method?.parameters.find((parameter) => parameter.name === 'frequency')).toMatchObject({
      defaultValue: 'month_end',
      values: ['month_end'],
    });
    expect(method?.returns).toMatchObject({
      kind: 'dataframe',
      columns: expect.arrayContaining([
        expect.objectContaining({ name: 'date' }),
        expect.objectContaining({ name: 'code' }),
        expect.objectContaining({ name: 'pb' }),
      ]),
    });
    expect(method?.examples[0]).toContain('data.panel("index:000300.SH"');
    expect(method?.notesEn.join(' ')).toContain('point-in-time historical membership');
    expect(researchSdkMethodsForCatalogQuery('000300.SH')).toEqual([]);
  });
});
