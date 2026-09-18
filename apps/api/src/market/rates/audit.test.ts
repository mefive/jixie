import { describe, expect, it } from 'vitest';
import { summarizeCreditCurvePit } from './audit.js';

describe('market data audit', () => {
  it('audits each required China credit curve independently', () => {
    expect(
      summarizeCreditCurvePit(
        [
          {
            seriesKey: 'chinabond_cgb_ytm',
            tradeDate: '20260730',
            availableDate: '20260731',
            validValue: true,
          },
          {
            seriesKey: 'chinabond_bank_aaa_ytm',
            tradeDate: '20260729',
            availableDate: '20260730',
            validValue: true,
          },
        ],
        new Set(['20260730', '20260731']),
        '20260731',
      ),
    ).toEqual({
      missingSeries: ['chinabond_cp_note_aaa_ytm'],
      invalidAvailabilityRows: 0,
      nonTradingAvailabilityRows: 0,
      invalidValueRows: 0,
      latestAvailableDate: '20260731',
      staleSeries: ['chinabond_bank_aaa_ytm'],
    });
  });
});
