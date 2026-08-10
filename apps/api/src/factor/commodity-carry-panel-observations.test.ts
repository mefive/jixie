import type { PanelFactorResearchSpecV1 } from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import type { CommodityCarryPointV1 } from '../commodity/commodity-carry.js';
import { compilePanelFactor } from './compile-time-series-factor.js';
import {
  buildCommodityCarryPanelObservations,
  COMMODITY_CARRY_PANEL_ASSETS,
} from './commodity-carry-panel-observations.js';
import type { PanelEtfDailyRow } from './panel-observations.js';

const factorCode = `export default defineFactorV2({
  version: 2,
  name: 'Commodity futures annualized carry',
  analysisKind: 'panel',
  outputScope: 'asset',
  frequency: 'daily',
  inputs: ['commodity.futures.annualizedLogCarry'],
  targetAssetClasses: ['commodity'],
  window: 2,
  compute(ctx) { return ctx.value('commodity.futures.annualizedLogCarry'); },
});`;

const spec: PanelFactorResearchSpecV1 = {
  version: 1,
  analysisKind: 'panel',
  start: '20240201',
  end: '20240430',
  observationFrequency: 'monthly',
  assets: COMMODITY_CARRY_PANEL_ASSETS.map((asset) => ({ ...asset })),
  target: { kind: 'forward_total_return', horizon: 2, horizonUnit: 'trade_day' },
  dataPolicy: { pointInTime: true, revisionPolicy: 'as_available', dataCutoff: '20240506' },
  rankingScope: 'cross_asset',
  volatilityScaling: 'none',
  minimumAssetsPerPeriod: 3,
  portfolio: { topFraction: 0.25, bottomFraction: 0.25, transactionCostPerSide: 0.001 },
};

const productByAsset = new Map([
  ['518880.SH', 'AU'],
  ['159980.SZ', 'CU'],
  ['159981.SZ', 'SC'],
  ['159985.SZ', 'M'],
]);

function openDates(): string[] {
  return ['01', '02', '03', '04', '05'].flatMap((month) =>
    Array.from(
      { length: 28 },
      (_value, index) => `2024${month}${String(index + 1).padStart(2, '0')}`,
    ),
  );
}

function etfRows(): PanelEtfDailyRow[] {
  return spec.assets.flatMap((asset, assetIndex) =>
    openDates().map((tradeDate, index) => ({
      assetId: asset.assetId,
      tradeDate,
      close: 100 + index * (assetIndex + 1),
      adjustmentFactor: 1,
    })),
  );
}

function carryPoint(
  productCode: string,
  asOfDate: string,
  annualizedLogCarry: number,
): CommodityCarryPointV1 {
  return {
    version: 1,
    productCode,
    asOfDate,
    availableDate: asOfDate,
    nearContract: `${productCode}N`,
    farContract: `${productCode}F`,
    nearDeliveryDate: '20240615',
    farDeliveryDate: '20240715',
    nearSettle: 101,
    farSettle: 100,
    tenorGapDays: 30,
    spreadReturn: 0.01,
    annualizedLogCarry,
    curveState: annualizedLogCarry > 0 ? 'backwardation' : 'contango',
    nearContractChanged: false,
  };
}

function carryPoints(): CommodityCarryPointV1[] {
  return spec.assets.flatMap((asset, assetIndex) => {
    const productCode = productByAsset.get(asset.assetId)!;
    return ['20240128', '20240228', '20240328', '20240428'].map((date, dateIndex) =>
      carryPoint(productCode, date, (assetIndex + 1) * 0.1 + dateIndex * 0.01),
    );
  });
}

async function build(points = carryPoints()) {
  const factor = await compilePanelFactor(factorCode);
  try {
    return await buildCommodityCarryPanelObservations(spec, etfRows(), openDates(), points, factor);
  } finally {
    factor.dispose();
  }
}

describe('commodity carry panel observations', () => {
  it('maps four product curves to common month-end ETF return targets', async () => {
    const observations = await build();

    expect(observations).toHaveLength(12);
    expect(new Set(observations.map((row) => row.asOfDate))).toEqual(
      new Set(['20240228', '20240328', '20240428']),
    );
    expect(
      observations.find((row) => row.assetId === '159980.SZ' && row.asOfDate === '20240328'),
    ).toMatchObject({
      assetClass: 'commodity',
      featureAvailableDate: '20240328',
      targetDate: '20240402',
      score: 0.22,
    });
    expect(
      observations.find((row) => row.assetId === '518880.SH' && row.asOfDate === '20240228'),
    ).toMatchObject({ assetClass: 'gold', score: 0.11 });
  });

  it('does not let a future curve point alter an earlier score', async () => {
    const baseline = await build();
    const changed = carryPoints().map((point) => ({ ...point }));
    changed.find(
      (point) => point.productCode === 'AU' && point.asOfDate === '20240428',
    )!.annualizedLogCarry = 99;
    const afterChange = await build(changed);

    expect(
      afterChange.find((row) => row.assetId === '518880.SH' && row.asOfDate === '20240328')?.score,
    ).toBe(
      baseline.find((row) => row.assetId === '518880.SH' && row.asOfDate === '20240328')?.score,
    );
  });

  it('drops a product when its latest curve is stale at the decision date', async () => {
    const points = carryPoints().filter(
      (point) => !(point.productCode === 'SC' && point.asOfDate === '20240328'),
    );
    const observations = await build(points);

    expect(
      observations.some((row) => row.assetId === '159981.SZ' && row.asOfDate === '20240328'),
    ).toBe(false);
  });
});
