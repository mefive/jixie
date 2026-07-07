import type { zhCommon } from '../zh/common';

// English mirror of zhCommon. The zh shape is the source of truth; this must stay structurally identical.
export const enCommon: typeof zhCommon = {
  appName: 'Jixie',
  nav: {
    backtest: 'Backtest Lab',
    screen: 'Screener',
    factor: 'Factors',
  },
  logout: 'Log out',
  language: {
    zh: '中',
    en: 'EN',
  },
};
