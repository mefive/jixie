import { describe, expect, it } from 'vitest';
import {
  RESEARCH_CROSS_SECTION_SDK_CONTRACT_V1,
  RESEARCH_PANEL_SDK_CONTRACT_V1,
  RESEARCH_SDK_CONTRACT_V1,
  RESEARCH_SERIES_SDK_CONTRACT_V1,
  createResearchSdkAgentCatalog,
} from '@jixie/shared';
import {
  parseResearchCrossSectionRuntimeRequest,
  parseResearchEquityDatasetRuntimeRows,
  parseResearchPanelRuntimeRequest,
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

  it('drives both fixed-schema equity dataset bridge requests', () => {
    expect(
      parseResearchCrossSectionRuntimeRequest({
        universe: 'index:000300.SH',
        date: '20251231',
        minimum_listed_days: 365,
        risk_warning: 'exclude',
      }),
    ).toEqual({
      universe: 'index:000300.SH',
      date: '20251231',
      minimum_listed_days: 365,
      risk_warning: 'exclude',
    });
    expect(
      parseResearchPanelRuntimeRequest({
        universe: 'cn_a',
        start: '20200101',
        end: '20251231',
        frequency: 'month_end',
        minimum_listed_days: 365,
        risk_warning: 'include',
      }),
    ).toMatchObject({ frequency: 'month_end', risk_warning: 'include' });
    expect(() =>
      parseResearchPanelRuntimeRequest({
        universe: 'cn_a',
        start: '2020-01-01',
        end: '20251231',
        frequency: 'week_end',
        minimum_listed_days: 365,
        risk_warning: 'exclude',
      }),
    ).toThrow();

    const row = Object.fromEntries(
      RESEARCH_CROSS_SECTION_SDK_CONTRACT_V1.returns.kind === 'dataframe'
        ? RESEARCH_CROSS_SECTION_SDK_CONTRACT_V1.returns.columns.map((column) => [
            column.name,
            column.wireType === 'trade_date'
              ? '20251231'
              : column.wireType === 'string'
                ? column.name
                : null,
          ])
        : [],
    );
    expect(parseResearchEquityDatasetRuntimeRows([row])).toEqual([row]);
    expect(RESEARCH_CROSS_SECTION_SDK_CONTRACT_V1.returns).toEqual(
      RESEARCH_PANEL_SDK_CONTRACT_V1.returns,
    );
  });

  it('publishes every M2 native chart through the same SDK contract', () => {
    expect(
      RESEARCH_SDK_CONTRACT_V1.functions
        .filter((contract) => contract.namespace === 'charts')
        .map((contract) => contract.name),
    ).toEqual(['line', 'area', 'bar', 'scatter', 'event_path', 'histogram', 'boxplot', 'heatmap']);
  });

  it('derives the Agent SDK catalog from the same public contract', () => {
    const sdkCatalog = createResearchSdkAgentCatalog();
    const panel = sdkCatalog.methods.find((method) => method.qualifiedName === 'data.panel');

    expect(sdkCatalog.runtimeVersion).toBe(RESEARCH_SDK_CONTRACT_V1.runtimeVersion);
    expect(sdkCatalog.methods).toHaveLength(RESEARCH_SDK_CONTRACT_V1.functions.length);
    expect(panel?.signature).toContain('frequency: Literal["month_end"] = "month_end"');
    expect(panel?.returns).toBe(RESEARCH_PANEL_SDK_CONTRACT_V1.returns);
    expect(panel?.examples).toEqual(RESEARCH_PANEL_SDK_CONTRACT_V1.examples);
    expect(panel?.notesEn).toEqual(RESEARCH_PANEL_SDK_CONTRACT_V1.notesEn);
  });
});
