import { describe, expect, it, vi } from 'vitest';
import type { ResearchDataCatalogResultV1 } from '@jixie/shared';
import { validateResearchSeriesProposal } from './series-validation.js';

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
              { line: 2, method: 'equity_dividends', identifier: '600519.SH' },
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
            equityRequests: [{ line: 1, method: 'equity_dividends', identifier: 'FAKE.SH' }],
          },
        ],
        vi.fn().mockResolvedValue({ ...stockCatalog, instruments: [] }),
      ),
    ).rejects.toThrow('not in the Research catalog');
  });

  it('validates ETF and index identifiers against the catalog', async () => {
    const referenceCatalog: ResearchDataCatalogResultV1 = {
      ...catalog,
      instruments: [
        { ...catalog.instruments[0]!, assetType: 'etf', identifier: '510300.SH' },
        { ...catalog.instruments[0]!, assetType: 'index', identifier: '000300.SH' },
      ],
      datasets: [],
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
            ],
          },
        ],
        search,
      ),
    ).resolves.toBeUndefined();
    expect(search).toHaveBeenCalledTimes(2);
  });
});
