import { describe, expect, it } from 'vitest';
import { buildSignalEmail } from './notifier.js';

describe('daily signal email', () => {
  it('renders a localized order summary without trusting instrument HTML', () => {
    const email = buildSignalEmail({
      locale: 'zh',
      strategyName: 'ETF 轮动',
      tradeDate: '20260728',
      execDate: '20260729',
      status: 'done',
      error: null,
      appUrl: 'https://jixie.example.com/',
      signals: [
        {
          code: '510300.SH',
          name: '<沪深300ETF>',
          assetType: 'etf',
          action: 'buy',
          shares: 1000,
          refPrice: 4.25,
          refAmount: 4250,
          source: 'target',
          targetWeight: 0.5,
        },
      ],
    });

    expect(email.subject).toContain('1 买 0 卖');
    expect(email.html).toContain('&lt;沪深300ETF&gt;');
    expect(email.html).toContain('https://jixie.example.com/signals');
  });

  it('renders empty and error subjects distinctly', () => {
    const empty = buildSignalEmail({
      locale: 'en',
      strategyName: 'Watch',
      tradeDate: '20260728',
      execDate: '20260729',
      status: 'done',
      error: null,
      signals: [],
    });
    const failed = buildSignalEmail({
      locale: 'en',
      strategyName: 'Watch',
      tradeDate: '20260728',
      execDate: '20260729',
      status: 'error',
      error: 'data missing',
      signals: [],
    });

    expect(empty.subject).toContain('no action');
    expect(failed.subject).toContain('failed');
    expect(failed.html).toContain('data missing');
  });
});
