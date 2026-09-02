import { describe, expect, it, vi } from 'vitest';
import type { ResearchDataCatalogResultV1 } from '@jixie/shared';
import { validateResearchSeriesProposal } from './research-series-proposal-validation.js';

const catalog: ResearchDataCatalogResultV1 = {
  version: 1,
  query: '000300.SH',
  sdkMethods: [],
  instruments: [
    {
      kind: 'instrument',
      assetType: 'index',
      identifier: '000300.SH',
      nameZh: '沪深 300',
      tags: [],
      compatibleMeasureIds: ['market.adjusted_close'],
    },
  ],
  datasets: [],
  factorReports: [],
  factorWeather: [],
  backtestReports: [],
  strategyScanReports: [],
  measures: [],
};

describe('Research Agent series proposal validation', () => {
  it('accepts only imports declared by the fixed Python runtime contract', async () => {
    await expect(
      validateResearchSeriesProposal([
        {
          cellId: 'supported',
          definitions: [],
          references: [],
          imports: ['scipy', 'statsmodels', 'matplotlib', 'math'],
        },
      ]),
    ).resolves.toBeUndefined();

    await expect(
      validateResearchSeriesProposal([
        {
          cellId: 'unsupported',
          definitions: [],
          references: [],
          imports: ['seaborn'],
        },
      ]),
    ).rejects.toThrow('runtime.python');
  });

  it('accepts an exact literal instrument and compatible measure', async () => {
    const search = vi.fn().mockResolvedValue(catalog);

    await expect(
      validateResearchSeriesProposal(
        [
          {
            cellId: 'cell-1',
            definitions: [],
            references: [],
            seriesRequests: [
              {
                line: 2,
                assetType: 'index',
                identifier: '000300.SH',
                measure: 'market.adjusted_close',
              },
            ],
          },
        ],
        search,
      ),
    ).resolves.toBeUndefined();
    expect(search).toHaveBeenCalledWith({ query: '000300.SH', assetType: 'index', limit: 50 });
  });

  it('rejects dynamic or invented data.series identities before review', async () => {
    const search = vi.fn().mockResolvedValue({ ...catalog, instruments: [] });

    await expect(
      validateResearchSeriesProposal(
        [
          {
            cellId: 'dynamic',
            definitions: [],
            references: [],
            seriesRequests: [
              { line: 4, assetType: 'index', identifier: null, measure: 'market.adjusted_close' },
            ],
          },
        ],
        search,
      ),
    ).rejects.toThrow('must use literal');
    await expect(
      validateResearchSeriesProposal(
        [
          {
            cellId: 'invented',
            definitions: [],
            references: [],
            seriesRequests: [
              {
                line: 7,
                assetType: 'index',
                identifier: 'NOT-A-SERIES',
                measure: 'market.adjusted_close',
              },
            ],
          },
        ],
        search,
      ),
    ).rejects.toThrow('not in the Research SDK instrument catalog');
  });

  it('accepts only literal yield-curve pairs in the governed SDK contract', async () => {
    await expect(
      validateResearchSeriesProposal([
        {
          cellId: 'yield',
          definitions: [],
          references: [],
          yieldCurveRequests: [
            { line: 2, curve: 'us_treasury_real', tenor: '10Y' },
            { line: 3, curve: 'us_treasury_nominal', tenor: '10Y' },
          ],
        },
      ]),
    ).resolves.toBeUndefined();

    await expect(
      validateResearchSeriesProposal([
        {
          cellId: 'dynamic-yield',
          definitions: [],
          references: [],
          yieldCurveRequests: [{ line: 4, curve: null, tenor: '10Y' }],
        },
      ]),
    ).rejects.toThrow('must use literal curve and tenor');

    await expect(
      validateResearchSeriesProposal([
        {
          cellId: 'unsupported-yield',
          definitions: [],
          references: [],
          yieldCurveRequests: [{ line: 5, curve: 'us_treasury_real', tenor: '1D' }],
        },
      ]),
    ).rejects.toThrow('unsupported curve/tenor pair');
  });

  it('accepts only literal governed macro and FX identities', async () => {
    await expect(
      validateResearchSeriesProposal([
        {
          cellId: 'macro-fx',
          definitions: [],
          references: [],
          macroRequests: [{ line: 1, series: 'cn_cpi_yoy' }],
          fxRequests: [{ line: 2, pair: 'HKDCNH.DERIVED' }],
        },
      ]),
    ).resolves.toBeUndefined();

    await expect(
      validateResearchSeriesProposal([
        {
          cellId: 'invented-macro',
          definitions: [],
          references: [],
          macroRequests: [{ line: 1, series: 'cn_invented' }],
        },
      ]),
    ).rejects.toThrow('unsupported series');

    await expect(
      validateResearchSeriesProposal([
        {
          cellId: 'dynamic-fx',
          definitions: [],
          references: [],
          fxRequests: [{ line: 1, pair: null }],
        },
      ]),
    ).rejects.toThrow('must use a literal pair');
  });

  it('validates literal commodity products against each dataset contract', async () => {
    await expect(
      validateResearchSeriesProposal([
        {
          cellId: 'commodity',
          definitions: [],
          references: [],
          commodityRequests: [
            { line: 1, method: 'commodity_returns', product: 'SC' },
            { line: 2, method: 'commodity_warehouse_receipts', product: 'SC' },
            { line: 3, method: 'commodity_holdings', product: 'AU' },
          ],
        },
      ]),
    ).resolves.toBeUndefined();

    await expect(
      validateResearchSeriesProposal([
        {
          cellId: 'unsupported-holdings',
          definitions: [],
          references: [],
          commodityRequests: [{ line: 1, method: 'commodity_holdings', product: 'SC' }],
        },
      ]),
    ).rejects.toThrow('unsupported product SC');
  });

  it('validates supplemental equity identifiers against the stock catalog', async () => {
    const stockCatalog: ResearchDataCatalogResultV1 = {
      ...catalog,
      instruments: [
        {
          kind: 'instrument',
          assetType: 'stock',
          identifier: '600519.SH',
          nameZh: '贵州茅台',
          tags: [],
          compatibleMeasureIds: ['market.adjusted_close'],
        },
      ],
    };
    const search = vi.fn().mockResolvedValue(stockCatalog);

    await expect(
      validateResearchSeriesProposal(
        [
          {
            cellId: 'stock-data',
            definitions: [],
            references: [],
            equityRequests: [
              { line: 1, method: 'equity_fundamentals', identifier: '600519.SH' },
              { line: 2, method: 'equity_flows', identifier: '600519.SH' },
              { line: 3, method: 'equity_dividends', identifier: '600519.SH' },
            ],
          },
        ],
        search,
      ),
    ).resolves.toBeUndefined();
    expect(search).toHaveBeenCalledTimes(3);

    await expect(
      validateResearchSeriesProposal(
        [
          {
            cellId: 'invented-stock',
            definitions: [],
            references: [],
            equityRequests: [{ line: 1, method: 'equity_flows', identifier: 'FAKE.SH' }],
          },
        ],
        vi.fn().mockResolvedValue({ ...stockCatalog, instruments: [] }),
      ),
    ).rejects.toThrow('not in the Research catalog');
  });

  it('validates ETF, index, industry, and actual-futures identifiers against the catalog', async () => {
    const referenceCatalog: ResearchDataCatalogResultV1 = {
      ...catalog,
      instruments: [
        { ...catalog.instruments[0]!, assetType: 'etf', identifier: '510300.SH' },
        { ...catalog.instruments[0]!, assetType: 'index', identifier: '000300.SH' },
        { ...catalog.instruments[0]!, assetType: 'future', identifier: 'IF2609.CFX' },
      ],
      datasets: [
        {
          kind: 'dataset',
          id: 'data.industry_state:801120.SI',
          method: 'data.industry_state',
          identifier: '801120.SI',
          nameZh: '食品饮料行业状态',
          nameEn: 'Food and beverage industry state',
          descriptionZh: '',
          descriptionEn: '',
          tags: ['食品饮料'],
          localDataCoverage: {
            status: 'ready',
            startDate: '20150105',
            endDate: '20260731',
            dateBasis: 'tradeDate',
          },
        },
      ],
    };
    const search = vi.fn().mockResolvedValue(referenceCatalog);

    await expect(
      validateResearchSeriesProposal(
        [
          {
            cellId: 'reference-data',
            definitions: [],
            references: [],
            equityRequests: [
              { line: 1, method: 'etf_shares', identifier: '510300.SH' },
              { line: 2, method: 'index_valuation', identifier: '000300.SH' },
              { line: 3, method: 'industry_state', identifier: '食品饮料' },
              { line: 4, method: 'futures_settlement', identifier: 'IF2609.CFX' },
            ],
          },
        ],
        search,
      ),
    ).resolves.toBeUndefined();
    expect(search).toHaveBeenCalledTimes(4);
  });
});
