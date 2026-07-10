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

  // Trade detail chart + list
  seriesKline: 'K-line',
  seriesStrategyReturn: 'Strategy',
  seriesBenchmark: 'CSI 300',
  seriesVolume: 'Volume',
  seriesTrade: 'Trades',
  navEquity: 'Equity',
  tdAll: 'All',
  tdHintAll:
    'K-line is the selected instrument; trade dots (yellow) and the list on the right cover all instruments. Prices are unadjusted real fill prices.',
  tdHintSingle:
    'Trade dots (yellow) sit on the axis below the K-line; click one → jump to it on the right. Prices are unadjusted real fill prices.',
  tdNoData: 'No data',
  tdColInstrument: 'Instrument',
  tdColDate: 'Date',
  tdColSide: 'Side',
  tdColShares: 'Shares',
  tdColPrice: 'Price',
  tdColAmount: 'Amount',
  sideBuy: 'Buy',
  sideSell: 'Sell',

  // Standalone trade-detail page
  tpTitle: 'Trade detail',
  tpMissingId: 'Missing strategy id',
  tpNotFound: 'Strategy not found or access denied',
  tpLoading: 'Loading…',
  tpNoTrades: 'This strategy has no trades yet',
  tpLoadingChart: 'Loading chart…',
  tradesUnit: '{{count}} trades',

  // Strategy card + picker
  deleteConfirmTitle: 'Confirm delete',
  deleteConfirmContent: 'Delete "{{name}}"? This cannot be undone.',
  delete: 'Delete',
  cancel: 'Cancel',
  notBacktested: 'Not run',
  myStrategies: 'My strategies',
  pickerEmpty: 'No saved strategies yet (running a backtest saves one automatically)',

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
