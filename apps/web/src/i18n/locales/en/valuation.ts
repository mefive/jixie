import type { zhValuation } from '../zh/valuation';

export const enValuation: typeof zhValuation = {
  kicker: 'Market temperature',
  title: 'Index Valuation',
  subtitle:
    'Put today back into history: the value curve shows what happened, while trading-day percentiles show how common the state has been.',
  selectIndex: 'Index',
  updated: 'Data through {{date}}',
  loading: 'Loading latest data',
  loadFailed: 'Failed to load index valuation',
  summaryLabel: 'Current valuation summary',
  tenYearPercentile: '10-year percentile',
  allHistoryPercentile: 'All history',
  low: 'Low',
  high: 'High',
  chartTitle: '{{index}} valuation history',
  chartSubtitle:
    'The dark line is the valuation metric and the light line is the index close. Drag the slider to zoom.',
  indexClose: 'Index close',
  closeAxis: '{{index}} level',
  methodLabel: 'Method',
  methodText:
    'Percentiles are weighted by trading day: valid historical days at or below the current value divided by all valid days. A level that persists longer carries more weight. The 10-year view uses a calendar-date cutoff; all history begins with the first available valuation observation.',
  metrics: {
    peTtm: 'P/E (TTM)',
    pb: 'P/B',
    pe: 'Static P/E',
    turnoverRate: 'Turnover',
  },
  range: {
    fiveYear: '5 years',
    tenYear: '10 years',
    all: 'All',
  },
  indices: {
    sseComposite: 'SSE Composite',
    sse50: 'SSE 50',
    csi300: 'CSI 300',
    csi500: 'CSI 500',
    szComponent: 'SZSE Component',
    sme: 'SME Board',
    chiNext: 'ChiNext',
    unknown: 'Index',
  },
};
