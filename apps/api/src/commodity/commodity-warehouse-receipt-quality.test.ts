import { describe, expect, it } from 'vitest';
import {
  summarizeCommodityWarehouseReceiptQuality,
  type CommodityWarehouseReceiptQualityRow,
} from './commodity-warehouse-receipt-quality.js';

const sourceByProduct = {
  AU: { sourceName: '黄金', unit: '千克' },
  CU: { sourceName: '铜', unit: '吨' },
  SC: { sourceName: '中质含硫原油', unit: '桶' },
  M: { sourceName: '豆粕', unit: '手' },
} as const;

function receipt(
  productCode: keyof typeof sourceByProduct,
  overrides: Partial<CommodityWarehouseReceiptQualityRow> = {},
): CommodityWarehouseReceiptQualityRow {
  const source = sourceByProduct[productCode];
  return {
    productCode,
    tradeDate: '20260807',
    availableDate: '20260810',
    sourceName: source.sourceName,
    sourceUnit: source.unit,
    unit: source.unit,
    unitCorrectionApplied: false,
    volume: 100,
    volumeChange: 1,
    sourceRowCount: 2,
    ...overrides,
  };
}

describe('commodity warehouse-receipt quality', () => {
  it('passes current product-level coverage without requiring every SC historical unit', () => {
    const summary = summarizeCommodityWarehouseReceiptQuality(
      [receipt('AU'), receipt('CU'), receipt('SC'), receipt('M')],
      ['20260803', '20260804', '20260805', '20260806', '20260807', '20260810'],
      '20260803',
      '20260807',
    );

    expect(summary.status).toBe('pass');
    expect(summary.errors).toEqual([]);
    expect(summary.products.find((product) => product.productCode === 'SC')).toMatchObject({
      rows: 1,
      latestTradeDate: '20260807',
      units: ['桶'],
    });
  });

  it('fails closed on PIT corruption, missing products, and excessive trading-day lag', () => {
    const summary = summarizeCommodityWarehouseReceiptQuality(
      [
        receipt('AU', { availableDate: '20260807' }),
        receipt('CU', {
          tradeDate: '20260803',
          availableDate: '20260804',
        }),
        receipt('SC'),
      ],
      ['20260803', '20260804', '20260805', '20260806', '20260807', '20260810'],
      '20260803',
      '20260807',
      2,
    );

    expect(summary.status).toBe('error');
    expect(summary.invalidRows).toBe(1);
    expect(summary.errors.join(' ')).toMatch(/invalid PIT availability/);
    expect(summary.errors.join(' ')).toMatch(/AU has no valid rows/);
    expect(summary.errors.join(' ')).toMatch(/CU is stale by 4 trading days/);
    expect(summary.errors.join(' ')).toMatch(/M has no valid rows/);
  });

  it('does not require a product before its documented source coverage begins', () => {
    const rows = [
      receipt('AU', {
        tradeDate: '20171229',
        availableDate: '20180102',
      }),
      receipt('CU', {
        tradeDate: '20171229',
        availableDate: '20180102',
      }),
      receipt('M', {
        tradeDate: '20171229',
        availableDate: '20180102',
      }),
    ];
    const summary = summarizeCommodityWarehouseReceiptQuality(
      rows,
      ['20171228', '20171229', '20180102'],
      '20171228',
      '20171229',
    );

    expect(summary.status).toBe('pass');
    expect(summary.products.find((product) => product.productCode === 'SC')).toMatchObject({
      rows: 0,
      latestTradeDate: null,
      lagTradingDays: null,
    });
  });

  it('accepts only an exact audited AU unit correction', () => {
    const correctedAu = receipt('AU', {
      tradeDate: '20200410',
      availableDate: '20200413',
      sourceUnit: '吨',
      unit: '千克',
      unitCorrectionApplied: true,
    });
    const otherProducts = (['CU', 'SC', 'M'] as const).map((productCode) =>
      receipt(productCode, {
        tradeDate: '20200410',
        availableDate: '20200413',
      }),
    );
    const valid = summarizeCommodityWarehouseReceiptQuality(
      [correctedAu, ...otherProducts],
      ['20200410', '20200413'],
      '20200410',
      '20200410',
    );

    expect(valid.status).toBe('pass');

    const invalid = summarizeCommodityWarehouseReceiptQuality(
      [{ ...correctedAu, tradeDate: '20200409', availableDate: '20200410' }, ...otherProducts],
      ['20200409', '20200410', '20200413'],
      '20200409',
      '20200410',
    );

    expect(invalid.invalidRows).toBe(1);
    expect(invalid.errors.join(' ')).toMatch(/invalid unit correction/);
  });
});
