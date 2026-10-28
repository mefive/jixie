import { describe, expect, it } from 'vitest';
import {
  RESEARCH_CROSS_SECTION_SDK_CONTRACT_V1,
  RESEARCH_EQUITY_DIVIDENDS_SDK_CONTRACT_V1,
  RESEARCH_EQUITY_FUNDAMENTALS_SDK_CONTRACT_V1,
  RESEARCH_BACKTEST_REPORT_SDK_CONTRACT_V1,
  RESEARCH_FACTOR_REPORT_SDK_CONTRACT_V1,
  RESEARCH_FINANCIAL_CROSS_SECTION_SDK_CONTRACT_V1,
  RESEARCH_FINANCIAL_METRICS_SDK_CONTRACT_V1,
  RESEARCH_FINANCIAL_PANEL_SDK_CONTRACT_V1,
  RESEARCH_FINANCIAL_STATEMENTS_SDK_CONTRACT_V1,
  RESEARCH_ETF_SHARES_SDK_CONTRACT_V1,
  RESEARCH_INDEX_VALUATION_SDK_CONTRACT_V1,
  RESEARCH_PANEL_SDK_CONTRACT_V1,
  RESEARCH_SDK_CONTRACT_V1,
  RESEARCH_SERIES_SDK_CONTRACT_V1,
  RESEARCH_STRATEGY_SCAN_REPORT_SDK_CONTRACT_V1,
  createResearchSdkAgentCatalog,
} from '@jixie/shared';
import {
  parseResearchCrossSectionRuntimeRequest,
  parseResearchEquityDividendsRuntimeRequest,
  parseResearchEquityFundamentalsRuntimeRequest,
  parseResearchEtfSharesRuntimeRequest,
  parseResearchBacktestReportRuntimeRequest,
  parseResearchEquityDatasetRuntimeRows,
  parseResearchFactorReportRuntimeRequest,
  parseResearchFinancialCrossSectionRuntimeRequest,
  parseResearchFinancialMetricsRuntimeRequest,
  parseResearchFinancialMetricsRuntimeRows,
  parseResearchFinancialPanelRuntimeRequest,
  parseResearchFinancialStatementsRuntimeRequest,
  parseResearchIndexValuationRuntimeRequest,
  parseResearchPanelRuntimeRequest,
  parseResearchSeriesRuntimeRequest,
  parseResearchStrategyScanReportRuntimeRequest,
  parseResearchSeriesRuntimeRows,
} from './validation.js';

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

  it('drives stock supplemental dataset bridges', () => {
    const stockRequest = { identifier: '600519.SH', start: '20200101', end: '20251231' };
    expect(parseResearchEquityFundamentalsRuntimeRequest(stockRequest)).toEqual(stockRequest);
    expect(parseResearchEquityDividendsRuntimeRequest(stockRequest)).toEqual(stockRequest);
    expect(RESEARCH_EQUITY_FUNDAMENTALS_SDK_CONTRACT_V1.qualifiedName).toBe(
      'data.equity_fundamentals',
    );
    expect(RESEARCH_EQUITY_DIVIDENDS_SDK_CONTRACT_V1.qualifiedName).toBe('data.equity_dividends');
  });

  it('drives ETF and index reference dataset bridges', () => {
    const request = { identifier: 'TEST', start: '20200101', end: '20251231' };
    expect(parseResearchEtfSharesRuntimeRequest(request)).toEqual(request);
    expect(parseResearchIndexValuationRuntimeRequest(request)).toEqual(request);
    expect(RESEARCH_ETF_SHARES_SDK_CONTRACT_V1.qualifiedName).toBe('data.etf_shares');
    expect(RESEARCH_INDEX_VALUATION_SDK_CONTRACT_V1.qualifiedName).toBe('data.index_valuation');
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
    expect(() => parseResearchEquityDatasetRuntimeRows([{ ...row, industry: 'Bank' }])).toThrow();
    expect(RESEARCH_CROSS_SECTION_SDK_CONTRACT_V1.returns).toEqual(
      RESEARCH_PANEL_SDK_CONTRACT_V1.returns,
    );
  });

  it('drives the four strict-PIT financial dataset bridges from one contract', () => {
    const single = { identifier: '000858.SZ', as_of: '20240429' };
    expect(parseResearchFinancialStatementsRuntimeRequest(single)).toEqual(single);
    expect(parseResearchFinancialMetricsRuntimeRequest(single)).toEqual(single);

    const crossSection = {
      universe: 'index:000300.SH',
      date: '20240429',
      metrics: ['revenue', 'returnOnInvestedCapital'],
      minimum_listed_days: 365,
      risk_warning: 'exclude',
    };
    expect(parseResearchFinancialCrossSectionRuntimeRequest(crossSection)).toEqual(crossSection);
    expect(
      parseResearchFinancialPanelRuntimeRequest({
        universe: 'index:000300.SH',
        start: '20200101',
        end: '20240429',
        frequency: 'month_end',
        metrics: 'freeCashFlowToFirm',
        minimum_listed_days: 365,
        risk_warning: 'exclude',
      }),
    ).toMatchObject({ metrics: 'freeCashFlowToFirm' });
    expect(() =>
      parseResearchFinancialCrossSectionRuntimeRequest({
        ...crossSection,
        metrics: 'provider_magic_metric',
      }),
    ).toThrow();
    expect(() =>
      parseResearchFinancialCrossSectionRuntimeRequest({
        ...crossSection,
        metrics: [
          'revenue',
          'grossMargin',
          'operatingMargin',
          'nopat',
          'returnOnAssets',
          'returnOnEquity',
          'returnOnInvestedCapital',
          'freeCashFlowToFirm',
          'enterpriseValue',
        ],
      }),
    ).toThrow();

    const metricRow = {
      date: '20240429',
      code: '000001.SZ',
      name: '平安银行',
      applicability: 'unsupported_financial',
      report_period: null,
      metric: 'returnOnInvestedCapital',
      value: null,
      unit: 'ratio',
      status: 'not_applicable',
      missing_reason: 'unsupported_financial_company',
      formula: 'NOPAT / average invested capital',
      formula_version: 'financial-metrics-v1',
      input_versions_json: '[]',
    };
    expect(parseResearchFinancialMetricsRuntimeRows([metricRow])).toEqual([metricRow]);
    expect([
      RESEARCH_FINANCIAL_STATEMENTS_SDK_CONTRACT_V1.qualifiedName,
      RESEARCH_FINANCIAL_METRICS_SDK_CONTRACT_V1.qualifiedName,
      RESEARCH_FINANCIAL_CROSS_SECTION_SDK_CONTRACT_V1.qualifiedName,
      RESEARCH_FINANCIAL_PANEL_SDK_CONTRACT_V1.qualifiedName,
    ]).toEqual([
      'data.equity_financial_statements',
      'data.equity_financial_metrics',
      'data.equity_financial_cross_section',
      'data.equity_financial_panel',
    ]);
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

  it('publishes an owner-scoped strategy-scan result bridge', () => {
    expect(parseResearchStrategyScanReportRuntimeRequest({ report_id: 'scan-1' })).toEqual({
      report_id: 'scan-1',
    });
    expect(RESEARCH_STRATEGY_SCAN_REPORT_SDK_CONTRACT_V1.qualifiedName).toBe(
      'results.strategy_scan_report',
    );
  });

  it('derives the Agent SDK catalog from the same public contract', () => {
    const sdkCatalog = createResearchSdkAgentCatalog();
    const panel = sdkCatalog.methods.find((method) => method.qualifiedName === 'data.panel');

    expect(sdkCatalog.runtimeVersion).toBe(RESEARCH_SDK_CONTRACT_V1.runtimeVersion);
    expect(sdkCatalog.methods).toHaveLength(RESEARCH_SDK_CONTRACT_V1.functions.length);
    expect(sdkCatalog.methods.map((method) => method.qualifiedName)).not.toContain(
      'results.factor_weather',
    );
    expect(panel?.signature).toContain('frequency: Literal["month_end"] = "month_end"');
    expect(panel?.returns).toBe(RESEARCH_PANEL_SDK_CONTRACT_V1.returns);
    expect(panel?.examples).toEqual(RESEARCH_PANEL_SDK_CONTRACT_V1.examples);
    expect(panel?.notesEn).toEqual(RESEARCH_PANEL_SDK_CONTRACT_V1.notesEn);
  });
});

it('omits retired valuation helpers from the public SDK and Agent catalog', () => {
  expect(
    RESEARCH_SDK_CONTRACT_V1.functions.some((contract) => contract.namespace === 'valuation'),
  ).toBe(false);
  const catalog = createResearchSdkAgentCatalog();
  expect(JSON.stringify(catalog)).not.toContain('valuation.fcff_scenarios');
  expect(JSON.stringify(catalog)).not.toContain('valuation.implied_revenue_growth');
});
