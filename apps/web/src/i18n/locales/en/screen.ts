import type { zhScreen } from '../zh/screen';

// English mirror of zhScreen (structurally identical — enforced by typeof).
export const enScreen: typeof zhScreen = {
  title: 'Screen',
  filter: {
    all: 'All',
    query: 'Queries',
    chat: 'Chats',
  },
  examplesLabel: 'Try:',
  newChat: 'New chat',
  wallEmpty:
    'No cards yet. Click "New chat" to describe the stocks you want to the agent and pin the resulting queries here; or try an example above.',
  card: {
    query: 'Query',
    chat: 'Chat',
    deleteQuery: 'Delete this filter?',
    deleteChat: 'Delete this chat? Pinned query cards are unaffected.',
    updatedRerun: 'Updated {{day}} · click to re-run',
    cardCount: '{{num}} cards · ',
    continueChat: 'click to continue',
  },
  wall: 'Card wall',
  namePlaceholder: 'Name this filter',
  pinToWall: 'Pin to wall',
  summary: 'Snapshot {{tradeDate}} · {{total}} matches (showing first {{shown}})',
  chatTitleFallback: 'New chat',
  heroTitle: 'What stocks are you looking for?',
  heroHint:
    'Describe your criteria to screen results, or just name a stock; pin filters you like to the wall to reuse them.',
  heroKbd: 'Enter to send · Shift+Space for newline',
  composerPlaceholder:
    'Describe the stocks you want, e.g. "large caps with PE below 15 and dividend yield above 3%"; or just ask "what is Moutai\'s PE now"',
  example: {
    lowPeHighDividend: 'Low PE, high dividend, large cap',
    smallCap: 'Small cap',
    highTurnover: 'High turnover',
    belowNav: 'Below NAV (PB<1)',
  },
  chatExample: {
    lowPeHighDividend: 'Large caps with PE below 15 and dividend yield above 3%',
    topTurnover: 'Top 20 by turnover',
    maotaiPe: "What is Moutai's PE now?",
  },
  column: {
    name: 'Name',
    close: 'Price',
    pctChg: 'Change',
    dvRatio: 'Div yield',
    totalMv: 'Mkt cap',
    turnoverRate: 'Turnover',
  },
  chips: {
    removeCondition: 'Remove condition',
    addCondition: 'Add condition',
    sort: 'Sort',
    noSort: 'No sort',
    sortDesc: 'High to low',
    sortAsc: 'Low to high',
  },
  field: {
    close: 'Current price',
    pctChg: 'Change %',
    pe: 'PE',
    peTtm: 'PE(TTM)',
    pb: 'PB',
    ps: 'PS',
    dvRatio: 'Dividend yield',
    totalMv: 'Total market cap',
    circMv: 'Float market cap',
    turnoverRate: 'Turnover',
  },
  unit: {
    close: 'CNY',
    pctChg: '%',
    dvRatio: '%',
    totalMv: '100M',
    circMv: '100M',
    turnoverRate: '%',
  },
  error: {
    withDetail: 'Error: {{detail}}',
    requestFailed: 'Request failed',
    conversationCreateFailed: 'Failed to create conversation, cannot start chat',
    cancelled: '(this reply was stopped)',
  },
};
