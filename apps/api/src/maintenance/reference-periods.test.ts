import { describe, expect, it } from 'vitest';
import { financialHistoryStart, quarterlyReportPeriods } from './reference-periods.js';

describe('financial reference periods', () => {
  it('builds inclusive quarter ends', () => {
    expect(quarterlyReportPeriods('20241231', '20250801')).toEqual([
      '20241231',
      '20250331',
      '20250630',
    ]);
  });

  it('includes the prior annual report before the market-data horizon', () => {
    expect(financialHistoryStart('20150105')).toBe('20141231');
  });
});
