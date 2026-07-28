import type { zhSignals } from '../zh/signals';

export const enSignals: typeof zhSignals = {
  title: 'Daily signals',
  subtitle:
    'Generated after the close for the next open. An empty signal is still an explicit decision.',
  refresh: 'Refresh',
  noDeployments: 'No deployed strategies yet. Complete a backtest in the Lab, then choose Deploy.',
  neverRun: 'Never generated',
  active: 'Active',
  version: 'Deployed {{date}} · code {{hash}}',
  generate: 'Generate now',
  generateHint: 'Uses the frozen deployment, never unsaved editor changes.',
  logEmpty: 'No run logs',
  noRuns: 'No signals have been generated yet.',
  signalDate: 'Signal date',
  execDate: 'Execution date',
  modelEquity: 'Model equity',
  notification: 'Email',
  notificationSent: 'Sent',
  notificationFailed: 'Failed',
  notificationSkipped: 'Skipped in development',
  noAction: 'No action today',
  noActionHint:
    'Doing nothing is still a mechanical decision and confirms the daily pipeline is healthy.',
  referenceNote:
    'Reference prices are raw closes on the signal date; actual fills depend on the next open and tradability.',
  history: 'Run history',
  instructionCount: '{{count}} instruction(s)',
  instrument: 'Instrument',
  asset: 'Asset',
  action: 'Side',
  shares: 'Shares',
  refPrice: 'Reference',
  refAmount: 'Est. amount',
  assetType: {
    stock: 'Stock',
    etf: 'ETF',
  },
  actionType: {
    buy: 'Buy',
    sell: 'Sell',
  },
  status: {
    running: 'Running',
    done: 'Done',
    error: 'Failed',
    stale: 'Interrupted',
  },
  loadFailed: 'Failed to load signals',
  generateFailed: 'Failed to generate signals',
  interrupted: 'Signal generation was interrupted by a service restart. Try again.',
};
