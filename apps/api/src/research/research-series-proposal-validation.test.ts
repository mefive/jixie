import { describe, expect, it, vi } from 'vitest';
import type { ResearchDataCatalogResultV1 } from '@jixie/shared';
import { validateResearchSeriesProposal } from './research-series-proposal-validation.js';

const catalog: ResearchDataCatalogResultV1 = {
  version: 1,
  query: '000300.SH',
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
  measures: [],
};

describe('Research Agent series proposal validation', () => {
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

  it('accepts only literal yield-curve pairs in the governed binding registry', async () => {
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
          yieldCurveRequests: [{ line: 5, curve: 'us_treasury_real', tenor: '1Y' }],
        },
      ]),
    ).rejects.toThrow('unsupported curve/tenor pair');
  });
});
