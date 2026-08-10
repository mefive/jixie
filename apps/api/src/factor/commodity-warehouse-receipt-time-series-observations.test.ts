import type { TimeSeriesFactorResearchSpecV1 } from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import { addDays } from '../lib/date.js';
import { compileTimeSeriesFactor } from './compile-time-series-factor.js';
import {
  buildCommodityWarehouseReceiptTimeSeriesObservations,
  timeSeriesFactorUsesCommodityWarehouseReceipts,
  type CommodityWarehouseReceiptResearchPoint,
} from './commodity-warehouse-receipt-time-series-observations.js';
import type { EtfTrendDailyRow } from './etf-trend-observations.js';

const factorCode = `export default defineFactorV2({
  version: 2,
  name: 'Commodity warehouse-receipt pressure 20d',
  analysisKind: 'time_series',
  outputScope: 'asset',
  frequency: 'daily',
  inputs: ['commodity.warehouseReceipt.volume'],
  targetAssetClasses: ['commodity'],
  window: 21,
  compute(ctx) {
    const current = ctx.value('commodity.warehouseReceipt.volume');
    const previous = ctx.lag('commodity.warehouseReceipt.volume', 20);
    return current != null && previous != null
      ? Math.log1p(previous) - Math.log1p(current)
      : null;
  },
});`;

const baseDate = '20240101';
const dateAt = (index: number) => addDays(baseDate, index);
const spec: TimeSeriesFactorResearchSpecV1 = {
  version: 1,
  analysisKind: 'time_series',
  start: dateAt(20),
  end: dateAt(25),
  observationFrequency: 'daily',
  assets: ['518880.SH', '159980.SZ', '159985.SZ'],
  target: { kind: 'forward_total_return', horizon: 2, horizonUnit: 'trade_day' },
  dataPolicy: { pointInTime: true, revisionPolicy: 'as_available', dataCutoff: dateAt(29) },
  inference: { standardError: 'newey_west', lag: 'automatic' },
};

const productByAsset = new Map([
  ['518880.SH', 'AU'],
  ['159980.SZ', 'CU'],
  ['159985.SZ', 'M'],
]);
const sourceByProduct = {
  AU: { sourceName: '黄金', unit: '千克', initialVolume: 100 },
  CU: { sourceName: '铜', unit: '吨', initialVolume: 200 },
  M: { sourceName: '豆粕', unit: '手', initialVolume: 300 },
} as const;

function etfRows(): EtfTrendDailyRow[] {
  return spec.assets.flatMap((assetId, assetIndex) =>
    Array.from({ length: 30 }, (_value, index) => ({
      assetId,
      tradeDate: dateAt(index),
      close: 100 + index * (assetIndex + 1),
      adjustmentFactor: 1,
    })),
  );
}

function warehouseReceiptPoints(): CommodityWarehouseReceiptResearchPoint[] {
  return spec.assets.flatMap((assetId) => {
    const productCode = productByAsset.get(assetId)! as keyof typeof sourceByProduct;
    const source = sourceByProduct[productCode];
    return Array.from({ length: 30 }, (_value, index) => ({
      productCode,
      tradeDate: dateAt(index - 1),
      availableDate: dateAt(index),
      sourceName: source.sourceName,
      sourceUnit: source.unit,
      unit: source.unit,
      unitCorrectionApplied: false,
      volume: source.initialVolume - index,
      sourceRowCount: 2,
    }));
  });
}

async function build(
  points: CommodityWarehouseReceiptResearchPoint[] = warehouseReceiptPoints(),
  rows: EtfTrendDailyRow[] = etfRows(),
) {
  const factor = await compileTimeSeriesFactor(factorCode);
  try {
    expect(timeSeriesFactorUsesCommodityWarehouseReceipts(factor)).toBe(true);
    return await buildCommodityWarehouseReceiptTimeSeriesObservations(spec, rows, points, factor);
  } finally {
    factor.dispose();
  }
}

describe('commodity warehouse-receipt time-series observations', () => {
  it('computes product-local pressure against only the mapped ETF forward return', async () => {
    const observations = await build();

    expect(observations).toHaveLength(18);
    const gold = observations.find(
      (observation) => observation.assetId === '518880.SH' && observation.asOfDate === dateAt(20),
    );
    expect(gold).toMatchObject({
      featureAvailableDate: dateAt(20),
      targetDate: dateAt(22),
    });
    expect(gold?.score).toBeCloseTo(Math.log1p(100) - Math.log1p(80), 12);
    expect(gold?.forwardReturn).toBeCloseTo(122 / 120 - 1, 12);

    const copper = observations.find(
      (observation) => observation.assetId === '159980.SZ' && observation.asOfDate === dateAt(20),
    );
    expect(copper?.score).toBeCloseTo(Math.log1p(200) - Math.log1p(180), 12);
  });

  it('does not let a later warehouse report change an earlier score', async () => {
    const baseline = await build();
    const changed = warehouseReceiptPoints().map((point) => ({ ...point }));
    changed.find(
      (point) => point.productCode === 'AU' && point.availableDate === dateAt(26),
    )!.volume = 0;
    const afterChange = await build(changed);

    expect(
      afterChange.find(
        (observation) => observation.assetId === '518880.SH' && observation.asOfDate === dateAt(25),
      )?.score,
    ).toBe(
      baseline.find(
        (observation) => observation.assetId === '518880.SH' && observation.asOfDate === dateAt(25),
      )?.score,
    );
  });

  it('drops observations when the latest product report is stale', async () => {
    const points = warehouseReceiptPoints().filter(
      (point) => point.productCode !== 'M' || point.availableDate <= dateAt(9),
    );
    const observations = await build(points);

    expect(observations.some((observation) => observation.assetId === '159985.SZ')).toBe(false);
    expect(observations.some((observation) => observation.assetId === '518880.SH')).toBe(true);
  });

  it('keeps zero warehouse volume finite through the frozen log1p transform', async () => {
    const points = warehouseReceiptPoints().map((point) => ({ ...point }));
    points.find(
      (point) => point.productCode === 'M' && point.availableDate === dateAt(20),
    )!.volume = 0;
    const observations = await build(points);
    const soybeanMeal = observations.find(
      (observation) => observation.assetId === '159985.SZ' && observation.asOfDate === dateAt(20),
    );

    expect(soybeanMeal?.score).toBeCloseTo(Math.log1p(300), 12);
  });

  it('fails closed on unit drift and the excluded crude-oil proxy', async () => {
    const invalid = warehouseReceiptPoints().map((point) => ({ ...point }));
    invalid[0].unit = '吨';
    await expect(build(invalid)).rejects.toThrow(/Invalid commodity warehouse-receipt/);

    const factor = await compileTimeSeriesFactor(factorCode);
    try {
      await expect(
        buildCommodityWarehouseReceiptTimeSeriesObservations(
          { ...spec, assets: ['159981.SZ'] },
          [],
          [],
          factor,
        ),
      ).rejects.toThrow(/does not map ETF/);
    } finally {
      factor.dispose();
    }
  });
});
