import type { zhFactor } from '../zh/factor';

// English mirror of zhFactor (structurally identical — enforced by typeof).
export const enFactor: typeof zhFactor = {
  agentLabel: 'Agent',
  libraryTab: 'Library',
  newFactor: 'New',

  unnamedNew: 'New factor (unsaved)',
  noneSelected: 'No factor selected',

  placeholderQa:
    'Ask about this preset factor — e.g. "is IC 0.03 strong?", "what horizon suits it?" — Enter to send',
  placeholderAuthor:
    'Describe the factor you want, e.g. "earnings yield 1/PE", "small cap"; or keep chatting to refine — Enter to send',

  chatEmptyQa:
    'This is a preset factor (read-only code, see the middle editor). Ask anything about it or the analysis — the Agent only answers, it does not edit the code; to tweak parameters into a variant, click "Copy as custom" above the editor.',
  chatEmptyAuthor:
    'Tell the Agent the factor you want (valuation / size / liquidity / money flow / price momentum & volatility) and it writes the code into the middle editor. Financial-statement detail (ROE growth, etc.) has no data yet.',

  presetGroup: 'Preset factors',
  customGroup: 'Custom factors',
  customEmpty: 'None yet — write one with the Agent',
  deleteTitle: 'Delete',
  deleteConfirmTitle: 'Confirm delete',
  deleteConfirmContent: 'Delete custom factor "{{name}}"? This cannot be undone.',
  deleteOk: 'Delete',
  cancel: 'Cancel',

  presetReadonly: 'Preset factor, code is read-only',
  forkToCustom: 'Copy as custom',
  editorLoading: 'Loading editor…',

  log: 'Log',
  logEmpty: 'Run an analysis to see the log here (system progress + your console output)',

  pickPrompt: '← Pick a factor, or have the Agent write one, then run analysis',

  freq: 'Frequency',
  range: 'Range',
  neutralLabel: 'Neutralize',
  neutralNone: 'None',
  neutralSize: 'Size',
  neutralSizeIndustry: 'Size + industry',
  neutralSizeTag: '·size-neut',
  neutralSizeIndustryTag: '·size+ind-neut',

  corrTrigger: 'Correlation matrix',
  corrTitle: 'Factor correlation matrix',
  corrSelectPlaceholder: 'Pick 2–8 factors',
  corrRun: 'Compute',
  corrHint:
    'Pairwise cross-sectional Spearman, averaged per {{per}}, over {{startYear}}–{{endYear}} (follows the params bar). Includes a fixed “size” column to catch cap bets',
  corrRunning: 'Computing… (windowed factors are slow; live progress omitted)',
  corrCap:
    'Mean over {{periods}} {{per}}s · red = positive (redundant) · blue = negative · diagonal = 1',
  corrEmpty: 'Pick at least 2 factors, then Compute',
  view: 'View',
  run: 'Run analysis',
  recompute: 'Recompute',
  runsLabel: 'Ran',
  unitWeek: 'week',
  unitMonth: 'month',

  computing:
    'Computing… (fundamentals / custom factors take seconds; the result is cached and instant next time) · live log in the middle "Log"',
  runPrompt: 'Set the frequency / range, then click "Run analysis"',
  sample: 'Sample {{periods}} {{per}} · {{startYear}}–{{endYear}}',
  weightEqual: 'Equal weight',
  weightMktcap: 'Market-cap weight',

  dirUp: 'Positive · long the top decile',
  dirDown: 'Negative · long the bottom decile',
  dirFlat: 'Direction not significant',

  decileCap:
    'X-axis D1 (lowest factor value) → D{{n}} (highest); Y-axis each decile\'s annualized "next {{per}}" return — a rising ramp = momentum, a falling ramp = reversal.',
  decileCapMktcap:
    ' Market-cap weight shows whether large caps actually earn it (equal weight is easily amplified by small caps).',

  metricIcMean: 'Rank IC mean',
  metricIcMeanHint: 'sign = direction · magnitude = strength',
  metricIcir: 'ICIR (annualized)',
  metricIcirHint: 'IC stability',
  metricIcPos: 'IC>0 rate',
  metricIcPosHint: 'share of {{per}}s with a consistent direction',
  metricLsAnn: 'Long-short D{{n}}−D1 ann.',
  metricLsAnnHint: 'pure factor return',
  metricLsSharpe: 'Long-short Sharpe',
  metricLsMdd: 'Long-short max drawdown',
  metricTopTurnover: 'Top-decile {{per}} turnover',
  metricTopTurnoverHint: 'higher = heavier friction',

  lsNavTitle: 'Long-short NAV · gross vs net',
  lsNavCap:
    'Equal-weight long-short; the net line deducts, each rebalance, both legs’ turnover × round-trip cost per name (commission + stamp + slippage ≈ 30bps). Shorting is constrained in A-shares, so the long-short is hypothetical — use this to compare factors’ survivability',
  lsNavGross: 'Gross',
  lsNavNet: 'Net',
  metricLsNetAnn: 'Net long-short (D10−D1) annualized',
  metricLsNetAnnHint: 'Long-short return after trading cost',
  metricLsNetSharpe: 'Net Sharpe',
  metricLsNetMdd: 'Net max drawdown',

  icDecayTitle: "IC decay · the factor's holding period",
  icDecayCap: 'X-axis forward trading days, Y-axis Rank IC — {{hint}}',
  decayPeak: '|IC| peaks at {{days}} days · {{trend}}',
  decayTrendSlow: 'stronger further out (slow factor, hold long)',
  decayTrendFast: 'stronger at the short end, then decays (fast factor, hold short)',

  heatmapTitle: "Decile × forward horizon · each decile's return across holding periods",
  heatmapCap:
    'Cell = average daily forward return (‱ bps of 10k, normalized by holding days, comparable across rows), red up / green down. See which horizon makes D1→D{{n}} most monotonic and whether the signal decays.',

  kindPrice: 'Price',
  kindFundamental: 'Fundamental',
  kindMoneyflow: 'Money flow',
  kindCustom: 'Custom',

  // Chart axis / tooltip labels (decile bar chart, IC-decay line, quantile heatmap).
  decileD1Low: 'D1 low',
  decileDnHigh: 'D{{n}} high',
  decileTipAnn: 'Ann. return {{pct}}%',
  decileTipSharpe: 'Sharpe {{sharpe}} · end NAV {{nav}}',
  icDecayTipHorizon: '{{days}}d forward',
  days: '{{days}}d',
  qhCorner: 'Horizon\\Decile',

  // Store-side messages (surfaced via i18n.t in factor-store.ts).
  errorPrefix: 'Error: {{message}}',
  saveFailed: 'failed to save the factor, cannot start the conversation',
  requestFailed: 'request failed',
  turnStopped: '(stopped this reply)',
  unnamedFactor: 'Untitled factor',
  analysisInterrupted: 'Analysis interrupted (server restarted), please retry',
  analysisFailed: 'Analysis failed',

  // Built-in preset factor display names, keyed by catalog slug (apps/api/src/factor/builtin-factors.ts).
  builtin: {
    mom: 'Momentum (60d, skip 5)',
    rev: 'Reversal (5d)',
    vol: 'Volatility (20d)',
    ep: 'Earnings yield (1/PE_TTM)',
    bp: 'Book-to-market (1/PB)',
    dv: 'Dividend yield (%)',
    size: 'Size (ln total market cap)',
    mf_net_main: 'Main-force net inflow (10k CNY)',
    mf_net_total: 'Total net inflow (10k CNY)',
  },
};
