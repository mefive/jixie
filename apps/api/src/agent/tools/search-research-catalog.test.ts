import { describe, expect, it } from 'vitest';
import {
  RESEARCH_PYTHON_RUNTIME_CAPABILITIES_V1,
  RESEARCH_PYTHON_RUNTIME_CATALOG_QUERY_V1,
} from '@jixie/shared';
import {
  createResearchCatalogTurnEvidence,
  createSearchResearchCatalogTool,
  etfInstrumentMatch,
  interpretResearchCatalogQuery,
  isResearchPythonRuntimeCatalogQuery,
  researchConceptDimensionMismatches,
  researchCatalogTenorYears,
  researchSdkMethodsForCatalogQuery,
} from './search-research-catalog.js';

describe('research catalog query interpretation', () => {
  it('fails closed when ETF metadata exists without local daily history', () => {
    const missing = etfInstrumentMatch(
      { tsCode: '510300.SH', name: '沪深300ETF', fundType: '股票型', indexName: '沪深300' },
      undefined,
    );
    const ready = etfInstrumentMatch(
      { tsCode: '510300.SH', name: '沪深300ETF', fundType: '股票型', indexName: '沪深300' },
      {
        _count: { _all: 2_000 },
        _min: { tradeDate: '20120528' },
        _max: { tradeDate: '20260821' },
      },
    );

    expect(missing).toMatchObject({
      researchRegistry: { exposureId: 'cn.csi_300', role: 'primary' },
      localDataCoverage: {
        status: 'missing',
        reason: 'source_available_but_local_data_missing',
      },
      sdkAccess: {
        status: 'not_ready',
        reason: 'source_available_but_local_data_missing',
      },
    });
    expect(ready).toMatchObject({
      localDataCoverage: { status: 'ready', observations: 2_000 },
      sdkAccess: { status: 'ready' },
    });
  });

  it('reserves the exact runtime.python query for the fixed Python capability contract', () => {
    expect(isResearchPythonRuntimeCatalogQuery('runtime.python')).toBe(true);
    expect(isResearchPythonRuntimeCatalogQuery('scipy')).toBe(false);
    expect(interpretResearchCatalogQuery({ text: 'runtime.python' })).toMatchObject({
      text: 'runtime.python',
      terms: [],
      conceptIds: [],
    });
  });

  it('returns the exact fixed runtime contract and records turn evidence', async () => {
    const evidence = createResearchCatalogTurnEvidence();
    const tool = createSearchResearchCatalogTool(evidence);

    const result = await tool.run({ text: RESEARCH_PYTHON_RUNTIME_CATALOG_QUERY_V1 });
    const observation = JSON.parse(result.observation);

    expect(observation.pythonRuntime).toEqual(RESEARCH_PYTHON_RUNTIME_CAPABILITIES_V1);
    expect(
      observation.pythonRuntime.packages.map((item: { distribution: string }) => item.distribution),
    ).toEqual(['numpy', 'pandas', 'scipy', 'statsmodels', 'matplotlib', 'scikit-learn']);
    expect(observation.pythonRuntime.outputPolicy.static).toContain('no CJK font');
    expect(observation.pythonRuntime.outputPolicy.static).toContain('concise English');
    expect(evidence.pythonRuntimeInspected).toBe(true);
    expect(result.rows).toBeGreaterThanOrEqual(1);
  });

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

  it('keeps LLM-selected concepts structured and compares requested proxy dimensions exactly', () => {
    const interpretation = interpretResearchCatalogQuery({
      conceptRequests: [
        {
          originalText: '美元现货黄金',
          conceptId: 'commodity.gold.price',
          dimensions: { instrumentForm: 'spot', quoteCurrency: 'USD' },
        },
      ],
    });

    expect(interpretation.explicitConceptIds).toEqual(['commodity.gold.price']);
    expect(interpretation.terms).toEqual([]);
    expect(
      researchConceptDimensionMismatches(
        { instrumentForm: 'spot', quoteCurrency: 'USD' },
        { instrumentForm: 'continuous_future', quoteCurrency: 'CNY', market: 'CN' },
      ),
    ).toEqual([
      { dimension: 'instrumentForm', requested: 'spot', available: 'continuous_future' },
      { dimension: 'quoteCurrency', requested: 'USD', available: 'CNY' },
    ]);
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

    const [yieldCurve] = researchSdkMethodsForCatalogQuery('data.yield_curve');
    expect(yieldCurve).toMatchObject({
      qualifiedName: 'data.yield_curve',
      returns: {
        kind: 'dataframe',
        columns: [
          expect.objectContaining({ name: 'date' }),
          expect.objectContaining({ name: 'value' }),
        ],
      },
    });
    expect(yieldCurve?.signature).toContain(
      'curve: Literal["us_treasury_nominal", "us_treasury_real"]',
    );
    expect(yieldCurve?.signature).toContain('tenor: Literal[');
    expect(yieldCurve?.notesEn.join(' ')).toContain('percentage-point change');
  });
});
