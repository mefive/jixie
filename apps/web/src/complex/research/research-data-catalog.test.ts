import assert from 'node:assert/strict';
import test from 'node:test';
import {
  researchBacktestReportSnippet,
  researchDatasetSnippet,
  researchFactorReportSnippet,
  researchSeriesSnippet,
  researchSeriesVariableName,
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

test('inserts an audited commodity dataset call', () => {
  assert.match(
    researchDatasetSnippet({
      dataset: {
        kind: 'dataset',
        id: 'data.commodity_warehouse_receipts:AU',
        method: 'data.commodity_warehouse_receipts',
        product: 'AU',
        nameZh: '黄金仓单',
        nameEn: 'Gold warehouse receipts',
        descriptionZh: '',
        descriptionEn: '',
        tags: [],
        localDataCoverage: {
          status: 'ready',
          startDate: '20150106',
          endDate: '20260803',
          dateBasis: 'availableDate',
        },
      },
      start: '20210101',
      end: '20260701',
    }),
    /au_warehouse_receipts = data\.commodity_warehouse_receipts\([\s\S]*"AU"/,
  );
});

test('inserts a governed market-state dataset call', () => {
  assert.match(
    researchDatasetSnippet({
      dataset: {
        kind: 'dataset',
        id: 'data.market_state:000300.SH',
        method: 'data.market_state',
        scope: '000300.SH',
        nameZh: '沪深 300 市场状态',
        nameEn: 'CSI 300 market state',
        descriptionZh: '',
        descriptionEn: '',
        tags: [],
        localDataCoverage: {
          status: 'ready',
          startDate: '20150130',
          endDate: '20260731',
          dateBasis: 'tradeDate',
        },
      },
      start: '20210101',
      end: '20260701',
    }),
    /market_state_000300_sh = data\.market_state\([\s\S]*"000300.SH"/,
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
