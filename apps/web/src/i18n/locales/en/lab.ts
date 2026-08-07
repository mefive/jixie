import type { zhLab } from '../zh/lab';

// English mirror of zhLab (structurally identical — enforced by typeof).
export const enLab: typeof zhLab = {
  // New-strategy hero + prompt block
  factorStarterPrompt:
    'Design a strategy using the published factor “{{name}}” (immutable key: {{key}}). Explain the universe, rebalance schedule, portfolio construction, and risk controls before generating backtestable code; use this key directly in both factors and ctx.factor.',
  factorTimeSeriesStarterPrompt:
    'Design an ETF rotation strategy using the published time-series signal “{{name}}” (immutable key: {{key}}). The research assets are {{assets}}. Put them in an explicit watch list, declare the key in factors, and read each ETF’s daily score with ctx.factor(key, ETF). Filter nulls, rank the scores, rebalance monthly with ctx.period, and equal-weight the strongest two; hold cash when fewer than two are valid. This is a research backtest—do not attempt deployment.',
  heroTitle: 'New strategy',
  heroHint: 'Describe your strategy in one sentence; the AI writes the code, then you tune it',
  newModalHint:
    'Describe your new strategy in one sentence; the AI writes the code, then you tune it',
  recentVisits: 'Recent',
  promptPlaceholder:
    'e.g. "Buy the 20 highest-dividend-yield stocks each month, equal weight" or "The 30 CSI 300 names with ROE above 15%, rebalanced monthly"',
  examplesLabel: 'Try:',
  writeCodeDirectly: 'Or write code directly →',
  strategyLanguage: 'Strategy language',
  newButton: 'New',

  // Example starter prompts (chip label + the sentence sent to the agent)
  exampleHighDivLabel: 'Top 20 dividend',
  exampleHighDivPrompt: 'Buy the 20 highest-dividend-yield stocks each month, equal weight',
  exampleLowValLabel: 'CSI 300 value',
  exampleLowValPrompt:
    'The 30 CSI 300 names with ROE above 15% and the lowest P/E, rebalanced monthly, equal weight',
  exampleMomentumLabel: 'CSI 500 momentum',
  exampleMomentumPrompt:
    'The 20 CSI 500 names with the strongest 20-day momentum, rotated weekly, equal weight',
  exampleEtfRotationLabel: 'Major ETF rotation',
  exampleEtfRotationPrompt:
    'Among the synced CSI 300, CSI 500, ChiNext, dividend, gold, and 5-year government-bond ETFs, select the two with the strongest trailing 60-trading-day momentum each month and hold them equal weight; stay in cash until enough history exists',

  // Unrun-edits leave guard
  unrunTitle: 'Unsaved changes',
  discardChanges: 'Discard changes',
  unrunBody:
    "The current strategy's code / parameter changes have not been run yet and will be lost if you leave. Run the backtest to save first, or discard the changes to continue.",

  // Agent panel
  agentUnsavedName: 'New strategy (unsaved)',
  historyTab: 'History',
  chatPlaceholder:
    'Keep chatting to adjust the strategy, e.g. "add a 5% stop loss" or "switch to weekly rebalancing" — Enter to send',
  chatEmpty:
    'Tell the Agent what strategy you want, or ask it to edit the current code. Changes are written straight into the editor in the middle.',
  historyEmpty: 'No strategies yet — running a backtest saves one automatically.',

  // Run-config header
  runStart: 'Start',
  runEnd: 'End',
  runCapital: 'Capital',
  runSlippageBps: 'Base slippage',
  runImpactCoef: 'Impact coefficient',
  runSummary: '{{start}} — {{end}} · {{capital}} × 10k',
  runParameters: 'Run parameters',
  runEditParameters: 'Edit run parameters',
  unitWan: 'w',
  runBacktest: 'Run backtest',
  runDisabledHint: 'Change the strategy to re-run',
  deploymentAction: 'Deploy',
  deploymentActionHint: 'Freeze this backtested version for daily close signals',
  deploymentActive: 'This backtested version is deployed',
  deploymentPause: 'Pause',
  deploymentOutdated: 'The live deployment is an older version; pause it before redeploying',
  deploymentRedeployNeeded: 'Pause old version',
  deploymentRunFirst: 'Run the current changes before deploying',
  deploymentNeedsResult: 'Run the strategy successfully before deploying',
  deploymentFailed: 'Failed to deploy the strategy',
  deploymentPauseFailed: 'Failed to pause the deployment',

  // Code editor
  loadingEditor: 'Loading editor…',
  sdkDocTooltip: 'SDK docs: {{name}}',
  sdkDocMenuLabel: '📖 View SDK docs',
  factorLinkTooltip: 'View factor implementation: {{name}}',
  factorImplementationLink: 'View factor implementation',
  languageSwitchTitle: 'Switch strategy language',
  languageSwitchBody: 'Switching replaces the current code with the selected language template.',
  languageSwitchConfirm: 'Switch and replace',
  pythonRuntimeHint: 'Stock / ETF preview',

  // Result overview
  runningCalc: 'Running backtest… live logs in the "Logs" panel below',
  runFailed: 'Backtest failed: {{error}}',
  resultEmpty: 'Write a strategy on the left, then click "Run backtest" to see equity and metrics.',
  loadingChart: 'Loading chart…',

  // Metrics (Sharpe / Calmar stay untranslated)
  metricAnnReturn: 'Ann. return',
  metricTotalReturn: 'Total return',
  metricExcessReturn: 'Excess return',
  metricInfoRatio: 'Info ratio',
  metricMaxDrawdown: 'Max drawdown',
  metricWinRate: 'Win rate',
  metricProfitFactor: 'Profit factor',
  metricTurnover: 'Turnover',
  metricFinalValue: 'Final equity',
  metricTrades: 'Trades',
  metricFees: 'Explicit fees (CNY)',
  metricSlippage: 'Slippage loss (CNY)',
  metricStockSleeve: 'Stock sleeve',
  metricFutureSleeve: 'Futures sleeve',
  metricFutureMargin: 'Futures margin',
  metricNetExposure: 'Net exposure',
  factorDependenciesTitle: 'Factors used by this backtest',
  factorDependenciesFrozen: 'Frozen by Factor ID and code hash',
  deploymentFactorBlocked: 'Time-series factors are currently limited to research backtests',

  // Performance charts
  navEquity: 'Equity',
  navStrategy: 'Strategy equity',
  chartEquity: 'Equity',
  chartDrawdown: 'Drawdown',
  benchmarkCompare: 'Compare indices',
  benchmarkFilter: 'Filter comparison indices',
  benchmarkRebasedHint: 'Indices are rebased to the strategy starting equity',
  benchmarkCsi300: 'CSI 300',
  benchmarkCsi500: 'CSI 500',
  benchmarkCsi1000: 'CSI 1000',
  benchmarkChiNext: 'ChiNext',
  drawdownPeak: 'Peak',
  drawdownTrough: 'Trough',
  drawdownRecovery: 'Recovery',
  drawdownNotRecovered: 'Not recovered',
  drawdownPeriod: 'Peak {{peak}} → trough {{trough}} → {{recovery}}',

  // Log dock
  logStarting: 'Starting the backtest process…',
  logEmpty: 'Run a strategy to see logs here (system progress + your console output)',
  logTab: 'Logs',

  // Result tabs
  tabOverview: 'Overview',
  tabTradeDetail: 'Trades ({{count}})',
  loadingTrades: 'Loading trades…',
  openInPage: 'Open in page',
  scanTab: 'Parameter scan',
  scanAction: 'Parameter scan',
  scanTitle: 'Scan experiments',
  scanStart: 'Start scan',
  scanIntro:
    'Reuse one backtest configuration to compare parameters, sizing schemes, or capital scales without rewriting strategy code.',
  scanViewParameters: 'Parameter robustness',
  scanViewSizing: 'Sizing comparison',
  scanViewCapacity: 'Capacity estimate',
  scanReadingParams: 'Reading strategy parameters…',
  scanNoParams: 'Declare params in defineStrategy and read them through ctx.params first.',
  scanNoSizingParam:
    "Sizing comparison needs a string parameter, for example params: { sizing: 'equal' }.",
  scanCapitalValues: 'Capital levels (CNY 10k)',
  scanCapitalValuesPlaceholder: 'For example 50, 200, 1000, 5000, 20000',
  scanCapitalValuesHint:
    'Enter 3–7 levels; each runs the same strategy and cost model independently.',
  scanCapitalValuesInvalid: 'Enter 3–7 distinct levels between CNY 10k and CNY 10 billion',
  scanDimensionOne: 'First dimension',
  scanDimensionTwo: 'Second dimension',
  scanTwoDimensions: 'Scan a second parameter',
  scanValuesPlaceholder: 'Comma-separated, e.g. 10, 20, 40',
  scanUseSplit: 'Also run in-sample / out-of-sample',
  scanSplitRequired: 'Choose a trading-day split',
  scanValuesInvalid: 'Enter at least two same-type finite values or non-empty names',
  scanHistory: 'Scan history',
  scanStarting: 'Starting parameter scan…',
  scanEmpty:
    'Declare strategy params, then test neighboring values and out-of-sample behavior here.',
  scanMeta: '{{count}} combinations · code {{hash}} · data through {{cutoff}}',
  scanInSample: 'In sample',
  scanOutOfSample: 'Out of sample',
  scanFullSample: 'Full sample',
  scanMetricSharpe: 'Sharpe',
  scanMetricVolatility: 'Annual volatility',
  scanMetricUnderwater: 'Longest underwater days',
  scanMetricSlippageDrag: 'Annual slippage drag',
  scanCapital: 'Initial capital',
  scanCapacityBaseline: 'Small-capital baseline',
  scanCapacitySlippageThreshold: 'Annual slippage drag ≥ 1%',
  scanCapacityHalfReturnThreshold: 'Annual return falls to half baseline',
  scanNotReached: 'Not reached',
  scanSubmitFailed: 'Failed to submit the parameter scan',
  scanLoadFailed: 'Failed to load the parameter-scan report',
  scanInterrupted: 'Parameter scan interrupted (service restarted); please retry',
  scanFailed: 'Parameter scan failed',
  scanStatus: {
    running: 'Running',
    done: 'Done',
    error: 'Failed',
    stale: 'Interrupted',
  },

  // Monthly returns table
  monthlyTitle: 'Monthly returns',
  monthLabel: '{{month}}',
  yearTotal: 'Year',

  // Trade execution detail
  tdMetricInstruments: 'Instruments',
  tdMetricBuySell: 'Buys / sells',
  tdMetricBuySellValue: '{{buy}} / {{sell}}',
  tdMetricTurnover: 'Gross turnover',
  tdMetricFees: 'Total fees',
  tdMetricSlippage: 'Total slippage',
  tdMetricAverage: 'Average fill',
  tdFilteredCount: '{{count}} fills',
  tdLedgerTitle: 'Fill ledger',
  tdFilterInstrument: 'All instruments',
  tdFilterSide: 'Side',
  tdFilterAsset: 'Asset',
  tdClearFilters: 'Clear',
  tdNoMatchingTrades: 'No fills match these filters',
  tdColInstrument: 'Instrument',
  tdColDate: 'Date',
  tdColSide: 'Side',
  tdColQuantity: 'Qty / contracts',
  tdColPrice: 'Price',
  tdColAmount: 'Amount',
  tdColFee: 'Fee (CNY)',
  tdColSlippage: 'Slippage (CNY)',
  tdActualContract: 'Actual {{code}}',
  assetStock: 'Stock',
  assetEtf: 'ETF',
  assetFuture: 'Futures',
  sideBuy: 'Buy',
  sideSell: 'Sell',

  // Standalone trade-detail page
  tpTitle: 'Trade detail',
  tpMissingId: 'Missing strategy id',
  tpNotFound: 'Strategy not found or access denied',
  tpLoading: 'Loading…',
  tpNoTrades: 'This strategy has no trades yet',
  tpLoadingDetail: 'Loading trade detail…',
  tradesUnit: '{{count}} trades',

  // Strategy card + picker
  deleteConfirmTitle: 'Confirm delete',
  deleteConfirmContent: 'Delete "{{name}}"? This cannot be undone.',
  delete: 'Delete',
  cancel: 'Cancel',
  notBacktested: 'Not run',

  // Store-driven messages (agent bubbles + backtest errors)
  storeError: 'Something went wrong: {{message}}',
  storeRequestFailed: 'Request failed',
  storeChatStartFailed: 'Something went wrong: failed to save the strategy, cannot start the chat',
  storeTurnStopped: '(this turn was stopped)',
  storeSaveFailedNoBacktest: 'Failed to save the strategy, cannot run the backtest',
  storeSaveFailed: 'Failed to save the strategy',
  storeSubmitFailed: 'Failed to submit the backtest',
  storeBacktestInterrupted: 'Backtest interrupted (service restarted), please retry',
  storeBacktestFailed: 'Backtest failed',
};
