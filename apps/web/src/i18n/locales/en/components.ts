import type { zhComponents } from '../zh/components';

// English mirror of zhComponents (structurally identical — enforced by typeof).
export const enComponents: typeof zhComponents = {
  // Agent turn stream (transient status lines)
  streamConnectionFailed: 'Stream connection failed',
  queryingTool: 'Querying {{name}}…',
  repairingCode: 'Code failed to compile, repairing (attempt {{round}})…',
  writingCode: 'Writing code…',
  thinking: 'Thinking…',
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

  // Chat chart
  points: '{{count}} points',
  chartQueryFailed: 'Chart query failed (conditions may be outdated): ',

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
