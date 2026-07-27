import type { zhLab } from '../zh/lab';

// English mirror of zhLab (structurally identical — enforced by typeof).
export const enLab: typeof zhLab = {
  // New-strategy hero + prompt block
  heroTitle: 'New strategy',
  heroHint: 'Describe your strategy in one sentence; the AI writes the code, then you tune it',
  newModalHint:
    'Describe your new strategy in one sentence; the AI writes the code, then you tune it',
  recentVisits: 'Recent',
  promptPlaceholder:
    'e.g. "Buy the 20 highest-dividend-yield stocks each month, equal weight" or "The 30 CSI 300 names with ROE above 15%, rebalanced monthly"',
  examplesLabel: 'Try:',
  writeCodeDirectly: 'Or write code directly →',
  firstTimeTutorial: 'First time? See the tutorial ↗',
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
  runSummary: '{{start}} — {{end}} · {{capital}} × 10k',
  runParameters: 'Run parameters',
  runEditParameters: 'Edit run parameters',
  unitWan: 'w',
  runBacktest: 'Run backtest',
  runDisabledHint: 'Change the strategy to re-run',

  // Code editor
  loadingEditor: 'Loading editor…',
  sdkDocTooltip: 'SDK docs: {{name}}',
  sdkDocMenuLabel: '📖 View SDK docs',
  factorLinkTooltip: 'View factor implementation: {{name}}',
  factorImplementationLink: 'View factor implementation',

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
  metricStockSleeve: 'Stock sleeve',
  metricFutureSleeve: 'Futures sleeve',
  metricFutureMargin: 'Futures margin',
  metricNetExposure: 'Net exposure',

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
