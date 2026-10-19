import type { zhComponents } from '../zh/components';

// English mirror of zhComponents (structurally identical — enforced by typeof).
export const enComponents: typeof zhComponents = {
  codeChange: {
    acceptedHint: 'Changes accepted and saved. Start analysis or a backtest separately.',
    title: 'Proposed code changes',
    hint: 'Your code is unchanged. Review the differences before accepting.',
    pending: 'Pending review',
    accepted: 'Accepted',
    view: 'View changes',
    accept: 'Accept changes',
    conflict: 'The current code or language has changed. Compare again or generate a new proposal.',
    loading: 'Loading differences…',
  },
  // Agent turn stream (transient status lines)
  streamConnectionFailed: 'Stream connection failed',
  queryingTool: 'Querying {{name}}…',
  repairingCode: 'Code failed to compile, repairing (attempt {{round}})…',
  writingCode: 'Writing code…',
  thinking: 'Thinking…',
  agentPhase: {
    reading_context: 'Reading research context…',
    querying_sdk: 'Querying the Research SDK…',
    generating_changes: 'Generating research content…',
    validating_proposal: 'Validating the change proposal…',
    awaiting_review: 'Awaiting review…',
  },
  stop: 'Stop',

  // Generic states
  queryFailed: 'Query failed',
  saveFailed: 'Save failed',
  loadFailed: 'Failed to load',
  retry: 'Retry',
  noData: 'No data',

  // Confirm dialog
  confirmTitle: 'Confirm',
  confirmOk: 'OK',
  cancel: 'Cancel',

  // Tool trace / DB query counts
  queriedDb: 'Queried DB {{count}} times:',
  queriedDbDone: 'Queried DB {{count}} times:',
  traceRows: ' → {{rows}} rows',
  traceFailed: ' → failed',
  traceShow: 'Show execution trace',
  traceHide: 'Hide execution trace',
  traceLoading: 'Loading execution trace…',
  reasoning: 'Model reasoning',
  traceArguments: 'Arguments',
  traceObservation: 'Tool result',
  traceModel: 'Model call {{count}}',
  traceTool: 'Tool {{name}}',
  traceValidation: 'Code validation {{round}}',
  traceError: 'Execution failed',
  traceCancelled: 'Execution cancelled',
  traceDuration: '{{duration}} ms',
  tracePassed: 'Passed',
  traceFailedStatus: 'Failed',

  // Retired historical artifacts
  retiredChartTitle: 'Historical chart',
  retiredChartDescription: 'Legacy chat charts have been retired. Use Research for a new analysis.',

  // Query card
  unnamedScreen: 'Untitled screen',
  pinnedToWall: 'Pinned to the card wall (Screen page)',
  stockCount: '{{count}} stocks',
  pinTooltip: 'Pin to the card wall (save this screen; rerun it anytime on the Screen page)',
  queryFailedMaybeExpired: 'Query failed (conditions may be outdated): ',
  moreRows: 'Top {{count}} shown; pin it to see all on the Screen page',
  nameColumn: 'Name',
  marketValueUnit: '00M',
  field: {
    close: 'Price',
    pctChg: 'Chg',
    dvRatio: 'Div yield',
    totalMv: 'Mkt cap',
    circMv: 'Float cap',
    turnoverRate: 'Turnover',
  },

  // Log view (line source tags)
  tagUser: 'User',
  tagSystem: 'System',
};
