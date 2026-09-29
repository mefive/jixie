import { describe, expect, it } from 'vitest';
import type { SignalTask } from '@jixie/shared';
import { summarizeSignalExecution } from './execution-summary.js';

function task(): SignalTask {
  return {
    id: 'task',
    execDate: '20260619',
    actualStatus: 'pending',
    actualReason: null,
    intent: {
      assetType: 'stock',
      code: 'A',
      name: 'A',
      action: 'buy',
      source: 'order',
      shares: 100,
      refPrice: 10,
      refAmount: 1000,
    },
    fills: [
      {
        id: 'fill',
        tradeDate: '20260619',
        replacesId: null,
        voided: false,
        payload: {
          expectedRevision: 0,
          clientRequestId: 'fill',
          actualCode: 'A',
          action: 'buy',
          effect: 'open',
          quantity: 50,
          price: 10.1,
          fee: 5,
          executedAt: '2026-06-19T09:31:00+08:00',
          tradeDate: '20260619',
          sequence: 0,
          reason: 'Partial fill',
        },
      },
    ],
    resolutions: [
      {
        id: 'sim',
        kind: 'simulation',
        accountRevision: 0,
        payload: { trades: [{ code: 'A', side: 'buy', price: 20, realPrice: 10 }] },
      },
    ],
  };
}

describe('execution quality summaries', () => {
  it('compares observed raw prices rather than adjusted prices and separates partial tasks', () => {
    const summary = summarizeSignalExecution(task());
    expect(summary.status).toBe('partial');
    expect(summary.averagePriceDeviationBps).toBeCloseTo(100);
  });

  it('excludes replaced facts and cannot compare different actual contracts', () => {
    const input = task();
    input.fills.push({ ...input.fills[0]!, id: 'void', replacesId: 'fill', voided: true });
    expect(summarizeSignalExecution(input)).toMatchObject({
      status: 'pending',
      fills: 0,
      averagePriceDeviationBps: null,
    });
    const mismatch = task();
    mismatch.resolutions[0]!.payload = {
      trades: [{ code: 'A', actualCode: 'DIFFERENT', side: 'buy', realPrice: 10 }],
    };
    expect(summarizeSignalExecution(mismatch).averagePriceDeviationBps).toBeNull();
  });
});
