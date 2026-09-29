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

  it('keeps a zero-reference futures intent out of the no-operation message', () => {
    const email = buildSignalEmail({
      locale: 'en',
      strategyName: 'Hedge',
      tradeDate: '20260618',
      execDate: '20260619',
      status: 'done',
      error: null,
      signals: [],
      futureSignals: [
        {
          assetType: 'future',
          code: 'IF.CFX',
          name: 'IF',
          intent: { kind: 'hedge', value: 1 },
          decisionDate: '20260618',
          execDate: '20260619',
          actualCode: 'IF2607.CFX',
          mappingDate: '20260618',
          referencePrice: 4000,
          multiplier: 300,
          referenceTargetContracts: 0,
          referenceNotional: 0,
          referenceMargin: 0,
          marginSource: 'config',
          referenceLegs: [],
        },
      ],
    });
    expect(email.html).toContain('IF2607.CFX');
    expect(email.subject).not.toContain('no action');
    expect(email.html).toContain('hedge');
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
