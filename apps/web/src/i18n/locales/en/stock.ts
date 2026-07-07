import type { zhStock } from '../zh/stock';

// English mirror of zhStock (structurally identical — enforced by typeof).
export const enStock: typeof zhStock = {
  adjust: {
    qfq: 'Pre-adjusted',
    hfq: 'Post-adjusted',
    none: 'Raw',
  },
  scale: {
    linear: 'Linear',
    log: 'Log',
  },
  loadFailed: 'Failed to load quotes: {{message}}',
  loadingLabel: 'Loading quotes…',
  chart: {
    candlestick: 'Candlestick',
    pe: 'PE',
    volume: 'Volume',
    priceAxis: 'Price',
  },
};
