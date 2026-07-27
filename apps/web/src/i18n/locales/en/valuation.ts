import type { zhValuation } from '../zh/valuation';

export const enValuation: typeof zhValuation = {
  kicker: 'Daily view',
  title: 'Market State',
  subtitle:
    'See valuation, trading activity, participation breadth, and concentration in their own historical context.',
  marketState: {
    today: 'Current state',
    todayScope: 'Current state · {{scope}}',
    coverage: 'Through {{date}} · {{count}} stocks',
    waiting: 'Loading the latest market cross-section',
    loadFailed: 'Failed to load market state',
    summaryLabel: 'Current market-state summary',
    threeYearPercentile: '3-year percentile',
    scopeLabel: 'Market-pulse universe',
    scopeAllHint: 'All A-shares traded on each day · history available from {{start}}',
    scopeIndexHint:
      'Point-in-time index constituents · history from {{start}} · current snapshot {{membership}}',
    scopes: {
      all: 'All A-shares',
      '000300_SH': 'CSI 300',
      '000905_SH': 'CSI 500',
      '000852_SH': 'CSI 1000',
      '932000_CSI': 'CSI 2000',
    },
    metrics: {
      activity: {
        label: 'Trading activity',
        description: '20-day average of float-cap-weighted turnover within {{scope}}.',
      },
      breadth: {
        label: 'Market breadth',
        description:
          'Equal blend of {{scope}} constituents above their 20-day and 60-day moving averages.',
      },
      trend: {
        label: 'Trend strength',
        description:
          '20-day {{scope}} return; All A-shares uses equal-weight adjusted stock returns.',
      },
      crowding: {
        label: 'Trading crowding',
        description: 'Share of {{scope}} turnover captured by its top 5% most-traded stocks.',
      },
    },
    details: {
      aboveMa20: 'Above MA20',
      aboveMa60: 'Above MA60',
      advance: 'Advanced today',
      limit: 'Closed at limit',
      limitValue: '{{up}} limit-up / {{down}} limit-down',
      amount: '{{scope}} turnover',
      amountValue: 'CNY {{value}} 100m',
    },
    history: {
      title: '{{scope}} pulse · 3 years',
      subtitle:
        'Each dimension states a different fact. Switch between them instead of collapsing them into one opaque temperature score.',
      percentAxis: 'Percent',
    },
    industry: {
      title: 'Shenwan Level-1 Direction Heat',
      subtitle:
        'Heat equally weights cross-sectional trend, cross-sectional breadth, and the industry’s own 3-year turnover percentile.',
      asOf: 'As of {{date}}',
      rank: 'Rank',
      name: 'Industry',
      heat: 'Heat',
      trendScore: 'Trend',
      breadthScore: 'Breadth',
      activityScore: 'Activity',
      excessReturn20: '20D excess',
      turnover: 'Turnover',
      amountShare: 'Amount share',
      concentration: 'Top-5 share',
    },
    methodLabel: 'Method',
    methodAllText:
      'Price windows use adjusted closes. The market universe contains stocks traded that day; each stock is assigned to the unique Shenwan Level-1 membership valid on that date. Activity, breadth, trend, and crowding remain separate. Percentiles describe how common the state has been over three years and do not forecast returns.',
    methodIndexText:
      'Each index universe uses the latest monthly constituent snapshot available on or before the observation date and carries it forward, avoiding today’s members in historical periods. Trend uses the official index close’s 20-day return; other metrics aggregate point-in-time constituents. Percentiles compare only with that index’s own available three-year history.',
    regimes: {
      hotBroad: { label: 'Hot and broad' },
      hotNarrow: { label: 'Hot but narrow' },
      coldBroad: { label: 'Quiet but broad' },
      coldWeak: { label: 'Cold and weak' },
      balanced: { label: 'Balanced' },
    },
  },
  valuationSection: {
    kicker: 'Valuation temperature',
    title: 'Major-index valuation',
    subtitle:
      'Valuation answers how expensive the market is, independently of activity and breadth.',
  },
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
