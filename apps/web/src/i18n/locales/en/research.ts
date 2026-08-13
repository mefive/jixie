import type { zhResearch } from '../zh/research';

export const enResearch: typeof zhResearch = {
  title: 'Research',
  newChat: 'New research',
  history: 'Research history',
  emptyHistory: 'No research yet',
  chatTitleFallback: 'Untitled research',
  heroTitle: 'What do you want to investigate?',
  heroHint:
    'Ask in plain language. The system selects data and methods and returns auditable results.',
  heroKbd: 'Enter to send, Shift + Enter for a new line',
  examplesLabel: 'Try one',
  composerPlaceholder: 'For example: Are CSI 300 and CSI 500 monthly returns correlated?',
  deleteChat: 'Delete this research record?',
  error: {
    withDetail: 'Research failed: {{detail}}',
    requestFailed: 'Request failed',
    cancelled: 'Research stopped',
  },
  chatExample: {
    indexRelationship:
      'Are CSI 300 and CSI 500 monthly returns correlated over the past five years? Include rolling correlation and regression.',
    ratesAndStocks:
      'How are monthly changes in the 10-year government bond yield related to CSI 300 monthly returns?',
    goldAndStocks: 'Does the correlation between gold and CSI 300 change over time?',
  },
  frequency: {
    daily: 'Daily',
    monthly: 'Monthly',
  },
  partialPeriod: {
    exclude: 'Exclude incomplete periods',
    include: 'Include incomplete periods',
  },
  transform: {
    level: 'Level',
    difference: 'Difference',
    simple_return: 'Simple return',
    percent_change: 'Percent change',
    year_over_year: 'Year over year',
  },
  universe: {
    migrated: 'Migrated from legacy screen',
    source: {
      equity_market: 'China equity market',
      index_members: 'Historical index members',
      explicit: 'Explicit entities',
    },
    asOf: {
      fixed: 'Fixed historical date',
      latest_available: 'Latest available date',
      periodic: 'Periodic snapshots',
    },
    missingExclude: 'Exclude missing values',
    noPredicates: 'All entities',
    limit: 'Up to {{count}}',
    sort: 'Sort',
  },
  result: {
    observations: 'Observations',
    pearson: 'Pearson',
    spearman: 'Spearman',
    slope: 'Regression slope',
    hacT: 'HAC t-stat',
    scatter: 'Scatter & regression',
    rolling: 'Rolling relationship',
    method: 'Method & reproduction',
    period: 'Research period',
    frequency: 'Alignment frequency',
    partialPeriod: 'Incomplete periods',
    predictor: 'Predictor',
    outcome: 'Outcome',
    lag: 'Predictor lag',
    hacLag: 'Newey–West lag',
    pythonExample: 'Python example',
    readConcept: 'Read the statistical concept guide',
  },
};
