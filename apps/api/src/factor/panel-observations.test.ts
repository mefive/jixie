import type { MultiAssetClass, PanelFactorResearchSpecV1 } from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import { compilePanelFactor } from './compile-time-series-factor.js';
import {
  buildPanelEtfObservations,
  panelEtfMatchesAssetClass,
  type PanelEtfDailyRow,
} from './panel-observations.js';

const assets = [
  { assetId: '510300.SH', assetClass: 'cn_equity' as const },
  { assetId: '513100.SH', assetClass: 'overseas_equity' as const },
  { assetId: '511010.SH', assetClass: 'fixed_income' as const },
  { assetId: '518880.SH', assetClass: 'gold' as const },
];

const spec: PanelFactorResearchSpecV1 = {
  version: 1,
  analysisKind: 'panel',
  start: '20240201',
  end: '20240430',
  observationFrequency: 'monthly',
  assets,
  target: { kind: 'forward_total_return', horizon: 2, horizonUnit: 'trade_day' },
  dataPolicy: { pointInTime: true, revisionPolicy: 'as_available', dataCutoff: '20240506' },
  rankingScope: 'cross_asset',
  volatilityScaling: 'none',
  minimumAssetsPerPeriod: 3,
  portfolio: { topFraction: 0.25, bottomFraction: 0.25, transactionCostPerSide: 0.001 },
};

const factorCode = `export default defineFactorV2({
  version: 2,
  name: 'Cross-asset momentum',
  analysisKind: 'panel',
  outputScope: 'asset',
  frequency: 'daily',
  inputs: ['etf.adjustedClose'],
  targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
  window: 21,
  compute(ctx) {
    const current = ctx.value('etf.adjustedClose');
    const previous = ctx.lag('etf.adjustedClose', 20);
    return current != null && previous != null ? current / previous - 1 : null;
  },
});`;

function openDates(): string[] {
  const dates: string[] = [];
  for (const month of ['01', '02', '03', '04', '05']) {
    for (let day = 1; day <= 28; day++) {
      dates.push(`2024${month}${String(day).padStart(2, '0')}`);
    }
  }
  return dates;
}

function rows(): PanelEtfDailyRow[] {
  return assets.flatMap((asset, assetIndex) =>
    openDates()
      .filter((date) => asset.assetId !== '518880.SH' || date >= '20240301')
      .map((tradeDate, index) => ({
        assetId: asset.assetId,
        tradeDate,
        close: 100 + index * (assetIndex + 1),
        adjustmentFactor: 1,
      })),
  );
}

async function build(sourceRows = rows()) {
  const factor = await compilePanelFactor(factorCode);
  try {
    return await buildPanelEtfObservations(spec, sourceRows, openDates(), factor);
  } finally {
    factor.dispose();
  }
}

describe('panel ETF observations', () => {
  it('uses common month-end decision and target dates while exposing late-listing coverage', async () => {
    const observations = await build();
    const byDate = new Map<string, typeof observations>();
    for (const observation of observations) {
      const rows = byDate.get(observation.asOfDate) ?? [];
      rows.push(observation);
      byDate.set(observation.asOfDate, rows);
    }

    expect([...byDate.keys()]).toEqual(['20240228', '20240328', '20240428']);
    expect(byDate.get('20240228')).toHaveLength(3);
    expect(byDate.get('20240328')).toHaveLength(4);
    expect(byDate.get('20240428')).toHaveLength(4);
    expect(byDate.get('20240228')?.map((observation) => observation.targetDate)).toEqual([
      '20240302',
      '20240302',
      '20240302',
    ]);
    expect(
      byDate
        .get('20240228')
        ?.every((observation) => observation.featureAvailableDate === '20240228'),
    ).toBe(true);
  });

  it('does not let target-period prices change the earlier panel score', async () => {
    const baseline = await build();
    const changed = rows().map((row) => ({ ...row }));
    const future = changed.find(
      (row) => row.assetId === '510300.SH' && row.tradeDate === '20240302',
    )!;
    future.close *= 10;
    const afterChange = await build(changed);
    const before = baseline.find(
      (row) => row.assetId === '510300.SH' && row.asOfDate === '20240228',
    )!;
    const after = afterChange.find(
      (row) => row.assetId === '510300.SH' && row.asOfDate === '20240228',
    )!;

    expect(after.score).toBe(before.score);
    expect(after.forwardReturn).not.toBe(before.forwardReturn);
  });

  it.each([
    ['cn_equity', { fundType: '股票型', etfType: '境内' }],
    ['overseas_equity', { fundType: '股票型', etfType: 'QDII' }],
    ['fixed_income', { fundType: '债券型', etfType: '纯境内' }],
    ['gold', { fundType: '商品型', etfType: '纯境内', name: '黄金ETF' }],
    ['commodity', { fundType: '商品型', etfType: '纯境内', name: '有色期货ETF' }],
  ])('validates %s ETF metadata', (assetClass, overrides) => {
    const metadata = {
      assetId: 'example',
      name: 'example',
      indexCode: null,
      indexName: null,
      fundType: null,
      etfType: null,
    };
    Object.assign(metadata, overrides);
    expect(panelEtfMatchesAssetClass(metadata, assetClass as MultiAssetClass)).toBe(true);
  });

  it.each([
    ['159985.SZ', '华夏饲料豆粕期货ETF', '大商所豆粕期货价格'],
    ['159980.SZ', '大成有色金属期货ETF', '上期有色金属指数'],
    ['159981.SZ', '建信易盛郑商所能源化工期货ETF', '易盛能化A'],
  ])('classifies the real commodity ETF metadata for %s', (assetId, name, indexName) => {
    expect(
      panelEtfMatchesAssetClass(
        {
          assetId,
          name,
          indexCode: null,
          indexName,
          fundType: '其他',
          etfType: '纯境内',
        },
        'commodity',
      ),
    ).toBe(true);
  });
});
