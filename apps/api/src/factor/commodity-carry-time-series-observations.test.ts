import type { TimeSeriesFactorResearchSpecV1 } from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import type { CommodityCarryPointV1 } from '../commodity/commodity-carry.js';
import { compileTimeSeriesFactor } from './compile-time-series-factor.js';
import {
  buildCommodityCarryTimeSeriesObservations,
  timeSeriesFactorUsesCommodityCarry,
} from './commodity-carry-time-series-observations.js';
import type { EtfTrendDailyRow } from './etf-trend-observations.js';

const factorCode = `export default defineFactorV2({
  version: 2,
  name: 'Commodity futures annualized carry time series',
  analysisKind: 'time_series',
  outputScope: 'asset',
  frequency: 'daily',
  inputs: ['commodity.futures.annualizedLogCarry'],
  targetAssetClasses: ['commodity'],
  window: 2,
  compute(ctx) { return ctx.value('commodity.futures.annualizedLogCarry'); },
});`;

const spec: TimeSeriesFactorResearchSpecV1 = {
  version: 1,
  analysisKind: 'time_series',
  start: '20240103',
  end: '20240110',
  observationFrequency: 'daily',
  assets: ['518880.SH', '159980.SZ', '159981.SZ', '159985.SZ'],
  target: { kind: 'forward_total_return', horizon: 2, horizonUnit: 'trade_day' },
  dataPolicy: { pointInTime: true, revisionPolicy: 'as_available', dataCutoff: '20240112' },
  inference: { standardError: 'newey_west', lag: 'automatic' },
};

const productByAsset = new Map([
  ['518880.SH', 'AU'],
  ['159980.SZ', 'CU'],
  ['159981.SZ', 'SC'],
  ['159985.SZ', 'M'],
]);

function etfRows(): EtfTrendDailyRow[] {
  return spec.assets.flatMap((assetId, assetIndex) =>
    Array.from({ length: 12 }, (_value, index) => ({
      assetId,
      tradeDate: `202401${String(index + 1).padStart(2, '0')}`,
      close: 100 + index * (assetIndex + 1),
      adjustmentFactor: 1,
    })),
  );
}

function carryPoint(
  productCode: string,
  asOfDate: string,
  availableDate: string,
  annualizedLogCarry: number,
): CommodityCarryPointV1 {
  return {
    version: 1,
    productCode,
    asOfDate,
    availableDate,
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
  return spec.assets.flatMap((assetId, assetIndex) => {
    const productCode = productByAsset.get(assetId)!;
    return Array.from({ length: 10 }, (_value, index) =>
      carryPoint(
        productCode,
        `202401${String(index + 1).padStart(2, '0')}`,
        `202401${String(index + 2).padStart(2, '0')}`,
        (assetIndex + 1) * 0.1 + index * 0.01,
      ),
    );
  });
}

async function build(
  points: CommodityCarryPointV1[] = carryPoints(),
  rows: EtfTrendDailyRow[] = etfRows(),
) {
  const factor = await compileTimeSeriesFactor(factorCode);
  try {
    expect(timeSeriesFactorUsesCommodityCarry(factor)).toBe(true);
    return await buildCommodityCarryTimeSeriesObservations(spec, rows, points, factor);
  } finally {
    factor.dispose();
  }
}

describe('commodity carry time-series observations', () => {
  it('tests each product carry against only its mapped ETF forward return', async () => {
    const observations = await build();

    expect(observations).toHaveLength(32);
    const copper = observations.find(
      (row) => row.assetId === '159980.SZ' && row.asOfDate === '20240105',
    );
    expect(copper).toMatchObject({
      featureAvailableDate: '20240105',
      targetDate: '20240107',
    });
    expect(copper?.score).toBeCloseTo(0.23, 12);
    expect(
      observations.find((row) => row.assetId === '518880.SH' && row.asOfDate === '20240103')
        ?.forwardReturn,
    ).toBeCloseTo(104 / 102 - 1, 12);
  });

  it('does not let a later carry point change an earlier score', async () => {
    const baseline = await build();
    const changed = carryPoints().map((point) => ({ ...point }));
    changed.find(
      (point) => point.productCode === 'AU' && point.asOfDate === '20240110',
    )!.annualizedLogCarry = 99;
    const afterChange = await build(changed);

    expect(
      afterChange.find((row) => row.assetId === '518880.SH' && row.asOfDate === '20240109')?.score,
    ).toBe(
      baseline.find((row) => row.assetId === '518880.SH' && row.asOfDate === '20240109')?.score,
    );
  });

  it('drops observations after the mapped product carry becomes stale', async () => {
    const points = carryPoints().filter(
      (point) => point.productCode !== 'SC' || point.asOfDate === '20240101',
    );
    const observations = await build(points);

    expect(
      observations.some((row) => row.assetId === '159981.SZ' && row.asOfDate === '20240108'),
    ).toBe(true);
    expect(
      observations.some((row) => row.assetId === '159981.SZ' && row.asOfDate === '20240109'),
    ).toBe(true);
    expect(
      observations.some((row) => row.assetId === '159981.SZ' && row.asOfDate === '20240110'),
    ).toBe(false);
  });

  it('fails closed on incomplete ETF prices or an unmapped target', async () => {
    const incomplete = etfRows().map((row) => ({ ...row }));
    incomplete[0].adjustmentFactor = Number.NaN;
    await expect(build(carryPoints(), incomplete)).rejects.toThrow(/Invalid commodity carry ETF/);

    const factor = await compileTimeSeriesFactor(factorCode);
    try {
      await expect(
        buildCommodityCarryTimeSeriesObservations(
          { ...spec, assets: ['510300.SH'] },
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
