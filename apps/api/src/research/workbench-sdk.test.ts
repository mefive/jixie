import { describe, expect, it } from 'vitest';
import {
  RESEARCH_CROSS_SECTION_SDK_CONTRACT_V1,
  RESEARCH_COMMODITY_HOLDINGS_SDK_CONTRACT_V1,
  RESEARCH_COMMODITY_RETURNS_SDK_CONTRACT_V1,
  RESEARCH_COMMODITY_WAREHOUSE_RECEIPTS_SDK_CONTRACT_V1,
  RESEARCH_BACKTEST_REPORT_SDK_CONTRACT_V1,
  RESEARCH_FACTOR_REPORT_SDK_CONTRACT_V1,
  RESEARCH_FX_SDK_CONTRACT_V1,
  RESEARCH_MACRO_SDK_CONTRACT_V1,
  RESEARCH_PANEL_SDK_CONTRACT_V1,
  RESEARCH_SDK_CONTRACT_V1,
  RESEARCH_SERIES_SDK_CONTRACT_V1,
  createResearchSdkAgentCatalog,
} from '@jixie/shared';
import {
  parseResearchCrossSectionRuntimeRequest,
  parseResearchCommodityHoldingsRuntimeRequest,
  parseResearchCommodityReturnsRuntimeRequest,
  parseResearchCommodityWarehouseReceiptsRuntimeRequest,
  parseResearchBacktestReportRuntimeRequest,
  parseResearchEquityDatasetRuntimeRows,
  parseResearchFactorReportRuntimeRequest,
  parseResearchFxRuntimeRequest,
  parseResearchMacroRuntimeRequest,
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

  it('drives the governed macro and FX bridge requests', () => {
    expect(
      parseResearchMacroRuntimeRequest({
        series: 'cn_cpi_yoy',
        start: '20200101',
        end: '20251231',
        frequency: 'monthly',
        transform: 'year_over_year',
        partial_period: 'exclude',
      }),
    ).toMatchObject({ series: 'cn_cpi_yoy', transform: 'year_over_year' });
    expect(
      parseResearchFxRuntimeRequest({
        pair: 'HKDCNH.DERIVED',
        start: '20200101',
        end: '20251231',
        frequency: 'daily',
        transform: 'percent_change',
        partial_period: 'exclude',
      }),
    ).toMatchObject({ pair: 'HKDCNH.DERIVED', transform: 'percent_change' });
    expect(RESEARCH_MACRO_SDK_CONTRACT_V1.qualifiedName).toBe('data.macro');
    expect(RESEARCH_FX_SDK_CONTRACT_V1.qualifiedName).toBe('data.fx');
  });

  it('drives the three governed commodity dataset bridges', () => {
    const request = { product: 'AU', start: '20200101', end: '20251231' };
    expect(parseResearchCommodityReturnsRuntimeRequest(request)).toEqual(request);
    expect(parseResearchCommodityWarehouseReceiptsRuntimeRequest(request)).toEqual(request);
    expect(parseResearchCommodityHoldingsRuntimeRequest(request)).toEqual(request);
    expect(() =>
      parseResearchCommodityHoldingsRuntimeRequest({ ...request, product: 'SC' }),
    ).toThrow();
    expect(RESEARCH_COMMODITY_RETURNS_SDK_CONTRACT_V1.qualifiedName).toBe('data.commodity_returns');
    expect(RESEARCH_COMMODITY_WAREHOUSE_RECEIPTS_SDK_CONTRACT_V1.qualifiedName).toBe(
      'data.commodity_warehouse_receipts',
    );
    expect(RESEARCH_COMMODITY_HOLDINGS_SDK_CONTRACT_V1.qualifiedName).toBe(
      'data.commodity_holdings',
    );
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

  it('publishes the owner-scoped FactorReport result bridge', () => {
    expect(parseResearchFactorReportRuntimeRequest({ report_id: 'report-1' })).toEqual({
      report_id: 'report-1',
    });
    expect(() => parseResearchFactorReportRuntimeRequest({ report_id: '' })).toThrow();
    expect(RESEARCH_FACTOR_REPORT_SDK_CONTRACT_V1).toMatchObject({
      qualifiedName: 'results.factor_report',
      returns: { kind: 'mapping', pythonType: 'Mapping[str, Any]' },
    });
  });

  it('publishes the owner-scoped BacktestReport result bridge', () => {
    expect(parseResearchBacktestReportRuntimeRequest({ report_id: 'backtest-report-1' })).toEqual({
      report_id: 'backtest-report-1',
    });
    expect(() => parseResearchBacktestReportRuntimeRequest({ report_id: '' })).toThrow();
    expect(RESEARCH_BACKTEST_REPORT_SDK_CONTRACT_V1).toMatchObject({
      qualifiedName: 'results.backtest_report',
      returns: { kind: 'mapping', pythonType: 'Mapping[str, Any]' },
    });
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
