import { describe, expect, it } from 'vitest';
import { stockMarketMembership, stockMarketRanges } from './market-range.js';

const stock = {
  tsCode: '000001.SZ',
  listDate: '20000101',
  delistDate: null,
  listStatus: 'L',
  exchange: 'SZSE',
};

describe('dated stock market membership', () => {
  it('uses catalog exchanges instead of code suffixes and preserves unknown exchanges', () => {
    const ranges = stockMarketRanges([
      { ...stock, tsCode: '900901.BJ', exchange: 'SSE' },
      { ...stock, tsCode: '920489.BJ', exchange: 'BSE' },
      { ...stock, tsCode: '920999.BJ', exchange: null },
    ]);

    expect(stockMarketMembership('900901.BJ', '20150105', ranges)).toBe('inside');
    expect(stockMarketMembership('920489.BJ', '20150105', ranges)).toBe('outside');
    expect(stockMarketMembership('920999.BJ', '20150105', ranges)).toBe('unknown');
  });

  it('includes listing and excludes the effective delisting date', () => {
    const ranges = stockMarketRanges([{ ...stock, listStatus: 'D', delistDate: '20200101' }]);

    expect(stockMarketMembership(stock.tsCode, '19991231', ranges)).toBe('outside');
    expect(stockMarketMembership(stock.tsCode, '20000101', ranges)).toBe('inside');
    expect(stockMarketMembership(stock.tsCode, '20191231', ranges)).toBe('inside');
    expect(stockMarketMembership(stock.tsCode, '20200101', ranges)).toBe('outside');
    expect(stockMarketMembership(stock.tsCode, '20200102', ranges)).toBe('outside');
  });

  it('does not treat paused listing as never listed or infer a historical suspension', () => {
    const ranges = stockMarketRanges([{ ...stock, listStatus: 'P' }]);

    expect(stockMarketMembership(stock.tsCode, '19991231', ranges)).toBe('outside');
    expect(stockMarketMembership(stock.tsCode, '20100101', ranges)).toBe('inside');
  });

  it.each(['G', 'UN'])(
    'excludes never-listed %s even when a scheduled date is present',
    (status) => {
      const pending = stockMarketRanges([{ ...stock, listDate: null, listStatus: status }]);
      const scheduled = stockMarketRanges([{ ...stock, listStatus: status }]);

      expect(stockMarketMembership(stock.tsCode, '19991231', pending)).toBe('outside');
      expect(stockMarketMembership(stock.tsCode, '19991231', scheduled)).toBe('outside');
      expect(stockMarketMembership(stock.tsCode, '20000101', scheduled)).toBe('outside');
    },
  );

  it('retains predecessor history and ignores the old identifier retirement date', () => {
    const ranges = stockMarketRanges([
      { ...stock, tsCode: '000022.SZ', listStatus: 'D', delistDate: '20181225' },
      { ...stock, tsCode: '001872.SZ', listDate: '20181226' },
    ]);

    for (const code of ['000022.SZ', '001872.SZ']) {
      expect(stockMarketMembership(code, '20150105', ranges)).toBe('inside');
      expect(stockMarketMembership(code, '20200102', ranges)).toBe('inside');
    }
  });

  it('does not exclude unknown predecessor history using only the successor date', () => {
    const ranges = stockMarketRanges([{ ...stock, tsCode: '001872.SZ', listDate: '20181226' }]);

    expect(stockMarketMembership('000022.SZ', '20150105', ranges)).toBe('unknown');
    expect(stockMarketMembership('001872.SZ', '20200102', ranges)).toBe('inside');

    const missingDate = stockMarketRanges([
      { ...stock, tsCode: '001872.SZ', listDate: '20181226' },
      { ...stock, tsCode: '000022.SZ', listDate: null, listStatus: 'D' },
    ]);
    expect(stockMarketMembership('000022.SZ', '20150105', missingDate)).toBe('unknown');
  });

  it('keeps missing and contradictory metadata unverified while applying proven market bounds', () => {
    const ranges = stockMarketRanges([
      { ...stock, listStatus: 'D' },
      { ...stock, tsCode: '000002.SZ', listDate: 'bad' },
      { ...stock, tsCode: '000003.SZ', delistDate: '19990101' },
    ]);

    for (const code of ['000001.SZ', '000002.SZ', '000003.SZ', '000004.SZ']) {
      expect(stockMarketMembership(code, '20150105', ranges)).toBe('unknown');
    }
    expect(stockMarketMembership('920139.BJ', '20221027', ranges)).toBe('outside');
    expect(stockMarketMembership('920139.BJ', '20221028', ranges)).toBe('unknown');
    expect(stockMarketMembership('920489.BJ', '20211114', ranges)).toBe('unknown');
  });
});
