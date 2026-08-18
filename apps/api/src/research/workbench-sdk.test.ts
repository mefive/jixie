import { describe, expect, it } from 'vitest';
import { RESEARCH_SERIES_SDK_CONTRACT_V1 } from '@jixie/shared';
import {
  parseResearchSeriesRuntimeRequest,
  parseResearchSeriesRuntimeRows,
} from './workbench-sdk.js';

describe('research workbench SDK contract', () => {
  it('drives the runtime request shape and enums', () => {
    expect(
      parseResearchSeriesRuntimeRequest({
        asset_type: 'index',
        identifier: '000300.SH',
        start: '20200101',
        end: '20251231',
        measure: 'market.adjusted_close',
        frequency: 'monthly',
        transform: 'simple_return',
        partial_period: 'exclude',
      }),
    ).toEqual({
      asset_type: 'index',
      identifier: '000300.SH',
      start: '20200101',
      end: '20251231',
      measure: 'market.adjusted_close',
      frequency: 'monthly',
      transform: 'simple_return',
      partial_period: 'exclude',
    });

    expect(() =>
      parseResearchSeriesRuntimeRequest({
        asset_type: 'crypto',
        identifier: 'BTC',
        start: '20200101',
        end: '20251231',
        measure: 'market.close',
        frequency: 'monthly',
        transform: 'simple_return',
        partial_period: 'exclude',
      }),
    ).toThrow();
  });

  it('validates bridge rows from the declared DataFrame columns', () => {
    expect(parseResearchSeriesRuntimeRows([{ date: '20251231', value: 0.012 }])).toEqual([
      { date: '20251231', value: 0.012 },
    ]);
    expect(() => parseResearchSeriesRuntimeRows([{ date: '2025-12-31', value: 0.012 }])).toThrow();
    expect(() =>
      parseResearchSeriesRuntimeRows([{ date: '20251231', value: 0.012, hidden: true }]),
    ).toThrow();

    expect(RESEARCH_SERIES_SDK_CONTRACT_V1.returns).toMatchObject({
      kind: 'dataframe',
      columns: [{ name: 'date' }, { name: 'value' }],
    });
  });
});
