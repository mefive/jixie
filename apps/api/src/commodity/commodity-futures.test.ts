import { describe, expect, it } from 'vitest';
import type { FutureContractRow } from '../tushare/api.js';
import {
  COMMODITY_FUTURE_PRODUCT_CODES,
  COMMODITY_MAIN_CONTRACT_SPECS,
  commodityFutureProductCodesForEtfs,
  commodityWarehouseReceiptProductCodesForEtfs,
  selectCommodityFutureContracts,
} from './commodity-futures.js';

function contract(exchange: string, productCode: string, tsCode: string): FutureContractRow {
  return {
    ts_code: tsCode,
    symbol: tsCode.split('.')[0],
    exchange,
    name: tsCode,
    fut_code: productCode,
    multiplier: 1,
    trade_unit: null,
    per_unit: null,
    quote_unit: null,
    quote_unit_desc: null,
    d_mode_desc: null,
    list_date: '20240101',
    delist_date: '20241231',
    d_month: '202412',
    last_ddate: '20241231',
    trade_time_desc: null,
  };
}

describe('commodity future universe', () => {
  it('keeps the four configured products and ignores unrelated contracts', () => {
    const rows = [
      contract('SHFE', 'au', 'AU2412.SHF'),
      contract('SHFE', 'CU', 'CU2412.SHF'),
      contract('INE', 'SC', 'SC2412.INE'),
      contract('DCE', 'M', 'M2412.DCE'),
      contract('SHFE', 'RB', 'RB2412.SHF'),
    ];

    expect(selectCommodityFutureContracts(rows).map((row) => row.ts_code)).toEqual([
      'AU2412.SHF',
      'CU2412.SHF',
      'SC2412.INE',
      'M2412.DCE',
    ]);
    expect(COMMODITY_FUTURE_PRODUCT_CODES).toEqual(['AU', 'CU', 'SC', 'M']);
    expect(COMMODITY_MAIN_CONTRACT_SPECS.map((item) => item.continuousCode)).toEqual([
      'AU.SHF',
      'CU.SHF',
      'SC.INE',
      'M.DCE',
    ]);
    expect(COMMODITY_MAIN_CONTRACT_SPECS.every((item) => !item.continuousCode.includes('L.'))).toBe(
      true,
    );
  });

  it('fails closed when one configured product is missing', () => {
    const rows = [
      contract('SHFE', 'AU', 'AU2412.SHF'),
      contract('SHFE', 'CU', 'CU2412.SHF'),
      contract('INE', 'SC', 'SC2412.INE'),
    ];

    expect(() => selectCommodityFutureContracts(rows)).toThrow(/DCE:M/);
  });

  it('maps only complete, unique ETF universes to their feature products', () => {
    expect(
      commodityFutureProductCodesForEtfs(['518880.SH', '159980.SZ', '159981.SZ', '159985.SZ']),
    ).toEqual(['AU', 'CU', 'SC', 'M']);
    expect(commodityFutureProductCodesForEtfs(['510300.SH'])).toBeNull();
    expect(commodityFutureProductCodesForEtfs(['518880.SH', '518880.SH'])).toBeNull();

    expect(
      commodityWarehouseReceiptProductCodesForEtfs(['518880.SH', '159980.SZ', '159985.SZ']),
    ).toEqual(['AU', 'CU', 'M']);
    expect(commodityWarehouseReceiptProductCodesForEtfs(['159981.SZ'])).toBeNull();
  });
});
