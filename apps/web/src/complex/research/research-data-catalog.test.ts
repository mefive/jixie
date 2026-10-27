import assert from 'node:assert/strict';
import test from 'node:test';
import {
  researchBacktestReportSnippet,
  researchDatasetSnippet,
  researchFactorReportSnippet,
  researchSeriesSnippet,
  researchSeriesSelection,
  researchFactorReportSelection,
  researchSeriesVariableName,
  researchStrategyScanReportSnippet,
} from './research-data-catalog';

const instrument = {
  kind: 'instrument' as const,
  assetType: 'index' as const,
  identifier: '000300.SH',
  nameZh: '沪深300',
  tags: ['规模指数'],
  compatibleMeasureIds: ['market.adjusted_close'],
};

test('creates a valid and stable Python variable name', () => {
  assert.equal(researchSeriesVariableName(instrument), 'index_000300_sh');
});

test('inserts the platform SDK call with explicit research semantics', () => {
  assert.equal(
    researchSeriesSnippet({
      instrument,
      measure: 'market.adjusted_close',
      start: '20200101',
      end: '20251231',
      frequency: 'monthly',
      transform: 'simple_return',
    }),
    `index_000300_sh = data.series(
    "index",
    "000300.SH",
    start="20200101",
    end="20251231",
    measure="market.adjusted_close",
    frequency="monthly",
    transform="simple_return",
)`,
  );
});

test('inserts an immutable FactorReport lookup by stable report id', () => {
  assert.equal(
    researchFactorReportSnippet({ id: 'report-01', factor: 'value-quality' }),
    'value_quality_report = results.factor_report("report-01")',
  );
});

test('inserts a point-in-time cross-section dataset call', () => {
  assert.equal(
    researchDatasetSnippet({
      dataset: {
        kind: 'dataset',
        id: 'data.cross_section:index:000300.SH',
        method: 'data.cross_section',
        universe: 'index:000300.SH',
        nameZh: '沪深 300 PIT 截面',
        nameEn: 'CSI 300 PIT cross-section',
        descriptionZh: '',
        descriptionEn: '',
        tags: [],
        localDataCoverage: {
          status: 'ready',
          startDate: '20150130',
          endDate: '20260701',
          dateBasis: 'tradeDate',
        },
      },
      start: '20210101',
      end: '20260701',
    }),
    `index_000300_sh_cross_section = data.cross_section(
    "index:000300.SH",
    date="20260701",
    minimum_listed_days=365,
    risk_warning="exclude",
)`,
  );
});

test('inserts a month-end panel dataset call', () => {
  assert.match(
    researchDatasetSnippet({
      dataset: {
        kind: 'dataset',
        id: 'data.panel:cn_a',
        method: 'data.panel',
        universe: 'cn_a',
        nameZh: '全 A 股月末面板',
        nameEn: 'China A-shares month-end panel',
        descriptionZh: '',
        descriptionEn: '',
        tags: [],
        localDataCoverage: { status: 'missing', reason: 'source_available_but_local_data_missing' },
      },
      start: '20210101',
      end: '20260701',
    }),
    /cn_a_panel = data\.panel\([\s\S]*frequency="month_end"/,
  );
});

test('inserts the four governed financial dataset calls', () => {
  const coverage = {
    status: 'ready' as const,
    startDate: '20230428',
    endDate: '20250430',
    dateBasis: 'availableDate' as const,
  };
  const shared = {
    kind: 'dataset' as const,
    nameZh: '财务数据',
    nameEn: 'Financial data',
    descriptionZh: '',
    descriptionEn: '',
    tags: [] as string[],
    localDataCoverage: coverage,
  };

  assert.equal(
    researchDatasetSnippet({
      dataset: {
        ...shared,
        id: 'data.equity_financial_statements',
        method: 'data.equity_financial_statements',
        identifier: '000858.SZ',
      },
      identifier: '600519.SH',
      start: '20200101',
      end: '20240429',
    }),
    `data_600519_sh_equity_financial_statements = data.equity_financial_statements(
    "600519.SH",
    as_of="20240429",
)`,
  );
  assert.match(
    researchDatasetSnippet({
      dataset: {
        ...shared,
        id: 'data.equity_financial_metrics',
        method: 'data.equity_financial_metrics',
        identifier: '000858.SZ',
      },
      identifier: '000858.SZ',
      start: '20200101',
      end: '20240429',
    }),
    /data_000858_sz_equity_financial_metrics = data\.equity_financial_metrics\([\s\S]*as_of="20240429"/,
  );
  assert.match(
    researchDatasetSnippet({
      dataset: {
        ...shared,
        id: 'data.equity_financial_cross_section:index:000300.SH',
        method: 'data.equity_financial_cross_section',
        universe: 'index:000300.SH',
      },
      metrics: ['revenue', 'returnOnInvestedCapital'],
      start: '20200101',
      end: '20240429',
    }),
    /equity_financial_cross_section\([\s\S]*metrics=\["revenue","returnOnInvestedCapital"\]/,
  );
  assert.match(
    researchDatasetSnippet({
      dataset: {
        ...shared,
        id: 'data.equity_financial_panel:cn_a',
        method: 'data.equity_financial_panel',
        universe: 'cn_a',
      },
      metrics: ['revenueGrowthYoY'],
      start: '20200101',
      end: '20241231',
    }),
    /equity_financial_panel\([\s\S]*frequency="month_end"[\s\S]*metrics=\["revenueGrowthYoY"\]/,
  );
});

test('inserts a governed yield-curve dataset call', () => {
  assert.match(
    researchDatasetSnippet({
      dataset: {
        kind: 'dataset',
        id: 'data.yield_curve:us_treasury_nominal:10Y',
        method: 'data.yield_curve',
        curve: 'us_treasury_nominal',
        tenor: '10Y',
        nameZh: '美国国债名义收益率 10Y',
        nameEn: 'US Treasury nominal yield 10Y',
        descriptionZh: '',
        descriptionEn: '',
        tags: [],
        localDataCoverage: { status: 'missing', reason: 'source_available_but_local_data_missing' },
      },
      start: '20210101',
      end: '20260701',
    }),
    /us_treasury_nominal_10y = data\.yield_curve\([\s\S]*tenor="10Y"/,
  );
});

test('inserts a governed identifier-based reference dataset call', () => {
  assert.match(
    researchDatasetSnippet({
      dataset: {
        kind: 'dataset',
        id: 'data.index_valuation:000300.SH',
        method: 'data.index_valuation',
        identifier: '000300.SH',
        nameZh: '沪深300官方估值',
        nameEn: 'CSI 300 official valuation',
        descriptionZh: '',
        descriptionEn: '',
        tags: [],
        localDataCoverage: {
          status: 'ready',
          startDate: '20150105',
          endDate: '20260731',
          dateBasis: 'tradeDate',
        },
      },
      start: '20210101',
      end: '20260701',
    }),
    /data_000300_sh_index_valuation = data\.index_valuation\([\s\S]*"000300.SH"/,
  );
});

test('inserts the retained ETF share dataset call', () => {
  assert.match(
    researchDatasetSnippet({
      dataset: {
        kind: 'dataset',
        id: 'data.etf_shares:510300.SH',
        method: 'data.etf_shares',
        identifier: '510300.SH',
        nameZh: '沪深300 ETF 份额',
        nameEn: 'CSI 300 ETF shares',
        descriptionZh: '',
        descriptionEn: '',
        tags: [],
        localDataCoverage: {
          status: 'ready',
          startDate: '20150105',
          endDate: '20260731',
          dateBasis: 'tradeDate',
        },
      },
      start: '20210101',
      end: '20260701',
    }),
    /data_510300_sh_etf_shares = data\.etf_shares\([\s\S]*"510300.SH"/,
  );
});

test('inserts an immutable BacktestReport lookup by stable report id', () => {
  assert.equal(
    researchBacktestReportSnippet({ id: 'backtest-report-01', strategyName: 'Value Rotation' }),
    'value_rotation_report = results.backtest_report("backtest-report-01")',
  );
});

test('keeps a BacktestReport variable valid for a Chinese name ending in digits', () => {
  assert.equal(
    researchBacktestReportSnippet({ id: 'backtest-report-02', strategyName: '价值轮动 2026' }),
    'backtest_2026_report = results.backtest_report("backtest-report-02")',
  );
});

test('inserts retained strategy-scan lookups', () => {
  assert.equal(
    researchStrategyScanReportSnippet({ id: 'scan-01', strategyName: 'Value Rotation' }),
    'value_rotation_scan = results.strategy_scan_report("scan-01")',
  );
});

test('inserts a batch field query with separate report and availability dates', () => {
  const source = researchDatasetSnippet({
    dataset: {
      kind: 'dataset',
      id: 'data.equity_financial_values',
      method: 'data.equity_financial_values',
      identifier: '000858.SZ',
      nameZh: '财报',
      nameEn: 'Statements',
      descriptionZh: '',
      descriptionEn: '',
      tags: [],
      localDataCoverage: {
        status: 'ready',
        startDate: '20200101',
        endDate: '20260506',
        dateBasis: 'availableDate',
      },
    },
    start: '20230101',
    end: '20260506',
    identifier: '000858.SZ,600519.SH',
    fields: ['income.revenue'],
    period: 'ttm',
    reportStart: '20240101',
    reportEnd: '20241231',
  });
  assert.ok(source.includes('["000858.SZ","600519.SH"]'));
  assert.match(source, /as_of="20260506"/);
  assert.match(source, /report_end="20241231"/);
  assert.match(source, /period="ttm"/);
});

test('keeps the chat attachment and inserted SDK request on the same explicit source', () => {
  const selected = researchSeriesSelection({
    instrument,
    measure: 'market.adjusted_close',
    start: '20200101',
    end: '20251231',
    frequency: 'monthly',
    transform: 'simple_return',
  });
  assert.deepEqual(selected.reference.arguments, {
    asset_type: 'index',
    identifier: '000300.SH',
    start: '20200101',
    end: '20251231',
    measure: 'market.adjusted_close',
    frequency: 'monthly',
    transform: 'simple_return',
  });
  assert.equal(selected.reference.method, 'research_series');
  assert.equal(
    selected.snippet,
    researchSeriesSnippet({
      instrument,
      measure: 'market.adjusted_close',
      start: '20200101',
      end: '20251231',
      frequency: 'monthly',
      transform: 'simple_return',
    }),
  );
  assert.deepEqual(
    researchFactorReportSelection({ id: 'saved-report', factor: 'ep' }).reference.arguments,
    { report_id: 'saved-report' },
  );
});
