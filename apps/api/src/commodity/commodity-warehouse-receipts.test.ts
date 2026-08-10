import { describe, expect, it, vi } from 'vitest';
import type { FutureWarehouseReceiptRow } from '../tushare/api.js';
import type { TushareClient } from '../tushare/client.js';
import {
  buildCommodityWarehouseReceiptDaily,
  COMMODITY_WAREHOUSE_RECEIPT_PAGE_LIMIT,
  fetchCommodityWarehouseReceiptRange,
  type CommodityWarehouseReceiptProductSpec,
} from './commodity-warehouse-receipts.js';

const copper: CommodityWarehouseReceiptProductSpec = {
  productCode: 'CU',
  sourceName: '铜',
  units: ['吨'],
};

function receipt(overrides: Partial<FutureWarehouseReceiptRow> = {}): FutureWarehouseReceiptRow {
  return {
    trade_date: '20260807',
    symbol: 'CU',
    fut_name: '铜',
    warehouse: '上海仓库',
    wh_id: 'SH01',
    pre_vol: 9,
    vol: 10,
    vol_chg: 1,
    area: '上海',
    year: null,
    grade: null,
    brand: null,
    place: null,
    pd: null,
    is_ct: null,
    unit: '吨',
    exchange: 'SHFE',
    ...overrides,
  };
}

describe('commodity warehouse-receipt V1', () => {
  it('isolates the configured product and removes subtotal rows before aggregation', () => {
    const rows = [
      receipt(),
      receipt({ warehouse: '广东仓库', wh_id: 'GD01', vol: 20, vol_chg: 2 }),
      receipt({ warehouse: '合计', wh_id: null, vol: 30, vol_chg: 3 }),
      receipt({ fut_name: '铜(BC)', warehouse: '保税仓库', wh_id: 'BC01', vol: 99 }),
    ];

    expect(
      buildCommodityWarehouseReceiptDaily(
        rows,
        copper,
        ['20260807', '20260810'],
        '20260801',
        '20260831',
      ),
    ).toEqual([
      {
        version: 1,
        productCode: 'CU',
        tradeDate: '20260807',
        availableDate: '20260810',
        sourceName: '铜',
        sourceUnit: '吨',
        unit: '吨',
        unitCorrectionApplied: false,
        volume: 30,
        volumeChange: 3,
        sourceRowCount: 2,
      },
    ]);
  });

  it('keeps original product units and never mixes a subtotal with a different unit', () => {
    const crudeOil: CommodityWarehouseReceiptProductSpec = {
      productCode: 'SC',
      sourceName: '中质含硫原油',
      units: ['桶', '吨'],
    };
    const rows = [
      receipt({
        symbol: 'SC',
        fut_name: '中质含硫原油',
        warehouse: '大连保税库',
        wh_id: 'SC01',
        unit: '桶',
        vol: 1_000,
        vol_chg: 100,
      }),
      receipt({
        symbol: 'SC',
        fut_name: '中质含硫原油',
        warehouse: '总计',
        wh_id: null,
        unit: '吨',
        vol: 150,
        vol_chg: 15,
      }),
    ];

    const points = buildCommodityWarehouseReceiptDaily(
      rows,
      crudeOil,
      ['20260810'],
      '20260801',
      '20260831',
    );

    expect(points[0]).toMatchObject({ unit: '桶', volume: 1_000, sourceRowCount: 1 });
  });

  it('keeps mixed SC physical units as separate daily aggregates', () => {
    const crudeOil: CommodityWarehouseReceiptProductSpec = {
      productCode: 'SC',
      sourceName: '中质含硫原油',
      units: ['桶', '吨'],
    };
    const rows = [
      receipt({
        symbol: 'SC',
        fut_name: '中质含硫原油',
        warehouse: '大连保税库',
        wh_id: 'SC01',
        unit: '桶',
        vol: 1_000,
      }),
      receipt({
        symbol: 'SC',
        fut_name: '中质含硫原油',
        warehouse: '曹妃甸',
        wh_id: 'SC02',
        unit: '吨',
        vol: 150,
      }),
    ];

    const points = buildCommodityWarehouseReceiptDaily(
      rows,
      crudeOil,
      ['20260810'],
      '20260801',
      '20260831',
    );

    expect(points).toMatchObject([
      { unit: '吨', sourceUnit: '吨', volume: 150, sourceRowCount: 1 },
      { unit: '桶', sourceUnit: '桶', volume: 1_000, sourceRowCount: 1 },
    ]);
  });

  it('preserves an unknown provider change as null instead of inventing a delta', () => {
    const points = buildCommodityWarehouseReceiptDaily(
      [receipt({ vol_chg: null })],
      copper,
      ['20260810'],
      '20260801',
      '20260831',
    );

    expect(points[0].volumeChange).toBeNull();
  });

  it('applies only the exact audited AU unit correction and preserves its source label', () => {
    const gold: CommodityWarehouseReceiptProductSpec = {
      productCode: 'AU',
      sourceName: '黄金',
      units: ['千克'],
    };
    const points = buildCommodityWarehouseReceiptDaily(
      [
        receipt({
          trade_date: '20200410',
          symbol: 'AU',
          fut_name: '黄金',
          warehouse: '上期所交割库',
          wh_id: null,
          unit: '吨',
          vol: 2_163,
          vol_chg: 0,
        }),
      ],
      gold,
      ['20200413'],
      '20200401',
      '20200430',
    );

    expect(points[0]).toMatchObject({
      sourceUnit: '吨',
      unit: '千克',
      unitCorrectionApplied: true,
      volume: 2_163,
    });
  });

  it('fails closed on duplicate physical rows, unit drift, subtotal-only dates, and missing PIT dates', () => {
    const row = receipt();
    expect(() =>
      buildCommodityWarehouseReceiptDaily([row, row], copper, ['20260810'], '20260801', '20260831'),
    ).toThrow(/Duplicate/);
    expect(() =>
      buildCommodityWarehouseReceiptDaily(
        [receipt({ unit: '千克' })],
        copper,
        ['20260810'],
        '20260801',
        '20260831',
      ),
    ).toThrow(/Invalid/);
    expect(() =>
      buildCommodityWarehouseReceiptDaily(
        [receipt({ warehouse: '合计' })],
        copper,
        ['20260810'],
        '20260801',
        '20260831',
      ),
    ).toThrow(/only subtotal/);
    expect(() =>
      buildCommodityWarehouseReceiptDaily([row], copper, ['20260807'], '20260801', '20260831'),
    ).toThrow(/No next SSE trading day/);
  });

  it('fails if the upstream endpoint repeats a full page instead of honoring offset', async () => {
    const page = Array.from({ length: COMMODITY_WAREHOUSE_RECEIPT_PAGE_LIMIT }, (_, index) =>
      receipt({ warehouse: `仓库${index}`, wh_id: String(index) }),
    );
    const call = vi.fn().mockResolvedValue(page);
    const client = { call } as unknown as TushareClient;

    await expect(
      fetchCommodityWarehouseReceiptRange(client, 'CU', '20260801', '20260831'),
    ).rejects.toThrow(/ignored offset pagination/);
    expect(call).toHaveBeenCalledTimes(2);
  });
});
