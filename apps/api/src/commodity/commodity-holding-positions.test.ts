import { describe, expect, it, vi } from 'vitest';
import type { FutureHoldingRow } from '../tushare/api.js';
import type { TushareClient } from '../tushare/client.js';
import {
  buildCommodityHoldingFetchRanges,
  buildCommodityHoldingPositions,
  fetchCommodityHoldingRange,
  selectCommodityHoldingRepresentatives,
  type CommodityHoldingContractBar,
  type CommodityHoldingFetchRange,
  type CommodityHoldingRepresentative,
} from './commodity-holding-positions.js';

describe('commodity holding positions', () => {
  it('selects maximum open interest with deterministic volume and code tie breakers', () => {
    const rows: CommodityHoldingContractBar[] = [
      bar({ tsCode: 'CU2508.SHF', openInterest: 100, volume: 80 }),
      bar({ tsCode: 'CU2509.SHF', openInterest: 120, volume: 50 }),
      bar({ tsCode: 'CU2510.SHF', openInterest: 120, volume: 70 }),
    ];

    expect(selectCommodityHoldingRepresentatives(rows)).toEqual([
      expect.objectContaining({ tsCode: 'CU2510.SHF', sourceSymbol: 'CU2510' }),
    ]);
  });

  it('groups adjacent representative dates into actual-contract fetch ranges', () => {
    const representatives = [
      representative({ tradeDate: '20250701', tsCode: 'CU2508.SHF' }),
      representative({ tradeDate: '20250702', tsCode: 'CU2508.SHF' }),
      representative({ tradeDate: '20250703', tsCode: 'CU2509.SHF' }),
    ];

    const ranges = buildCommodityHoldingFetchRanges(representatives);

    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toEqual(
      expect.objectContaining({
        referenceContract: 'CU2508.SHF',
        startDate: '20250701',
        endDate: '20250702',
      }),
    );
  });

  it('aggregates the ranked subsets and gates them to the next SSE session', () => {
    const representativeRow = representative({ openInterest: 1_000, volume: 2_000 });
    const rows = [
      holding('甲期货', {
        vol: 500,
        vol_chg: 20,
        long_hld: 300,
        long_chg: 10,
        short_hld: 0,
        short_chg: 0,
      }),
      holding('乙期货', {
        vol: 400,
        vol_chg: -10,
        long_hld: 0,
        long_chg: 0,
        short_hld: 350,
        short_chg: 15,
      }),
      holding('丙期货', {
        vol: 300,
        vol_chg: 5,
        long_hld: 200,
        long_chg: -5,
        short_hld: 150,
        short_chg: null,
      }),
      holding('期货公司', {
        vol: 10_000,
        long_hld: 9_000,
        short_hld: 8_000,
      }),
    ];

    const points = buildCommodityHoldingPositions(
      rows,
      [representativeRow],
      ['20250701', '20250702'],
    );

    expect(points).toEqual([
      expect.objectContaining({
        tradeDate: '20250701',
        availableDate: '20250702',
        referenceContract: 'CU2508.SHF',
        rankedVolume: 1_200,
        rankedVolumeChange: 15,
        rankedLongHolding: 500,
        rankedLongChange: 5,
        rankedShortHolding: 500,
        rankedShortChange: null,
        topFiveLongHolding: 500,
        topFiveShortHolding: 500,
        volumeMemberCount: 3,
        longMemberCount: 2,
        shortMemberCount: 2,
        sourceRowCount: 4,
        excludedSummaryRowCount: 1,
      }),
    ]);
  });

  it('rejects ranked holdings above the selected contract open interest', () => {
    expect(() =>
      buildCommodityHoldingPositions(
        [holding('甲期货', { vol: 10, long_hld: 101, short_hld: 10 })],
        [representative({ openInterest: 100 })],
        ['20250702'],
      ),
    ).toThrow(/exceeds contract open interest/);
  });

  it('keeps a source date missing when one of the three ranked lists is absent', () => {
    expect(
      buildCommodityHoldingPositions(
        [holding('甲期货', { vol: 10, long_hld: 20, short_hld: null })],
        [representative()],
        ['20250702'],
      ),
    ).toEqual([]);
  });

  it('applies only the audited M 2020-11-06 doubled-row correction', () => {
    const point = buildCommodityHoldingPositions(
      [
        holding('甲期货', {
          trade_date: '20201106',
          symbol: 'M2105',
          vol: 200,
          vol_chg: 20,
          long_hld: 160,
          long_chg: 10,
          short_hld: 180,
          short_chg: -20,
        }),
      ],
      [
        {
          productCode: 'M',
          exchange: 'DCE',
          tsCode: 'M2105.DCE',
          sourceSymbol: 'M2105',
          tradeDate: '20201106',
          openInterest: 100,
          volume: 200,
        },
      ],
      ['20201109'],
    )[0]!;

    expect(point).toEqual(
      expect.objectContaining({
        rankedVolume: 100,
        rankedLongHolding: 80,
        rankedShortHolding: 90,
        sourceCorrectionApplied: true,
      }),
    );
  });

  it('paginates a contract spell with explicit offsets', async () => {
    const firstPage = Array.from({ length: 2_000 }, (_, index) =>
      holding(`会员${index}`, { trade_date: '20250701' }),
    );
    const boundaryDuplicate = firstPage.at(-1)!;
    const finalRow = holding('最终会员', { trade_date: '20250702' });
    const call = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([boundaryDuplicate, finalRow]);
    const client = { call } as unknown as TushareClient;

    const rows = await fetchCommodityHoldingRange(client, fetchRange());

    expect(rows).toHaveLength(2_001);
    expect(call).toHaveBeenNthCalledWith(
      2,
      'fut_holding',
      expect.objectContaining({ offset: 2_000 }),
      expect.any(String),
    );
  });
});

function bar(overrides: Partial<CommodityHoldingContractBar> = {}): CommodityHoldingContractBar {
  return {
    productCode: 'CU',
    exchange: 'SHFE',
    tsCode: 'CU2508.SHF',
    tradeDate: '20250701',
    openInterest: 100,
    volume: 50,
    ...overrides,
  };
}

function representative(
  overrides: Partial<CommodityHoldingRepresentative> = {},
): CommodityHoldingRepresentative {
  const value = bar(overrides);
  return { ...value, sourceSymbol: value.tsCode.split('.')[0]! };
}

function holding(broker: string, overrides: Partial<FutureHoldingRow> = {}): FutureHoldingRow {
  return {
    trade_date: '20250701',
    symbol: 'CU2508',
    broker,
    vol: 1,
    vol_chg: 0,
    long_hld: 1,
    long_chg: 0,
    short_hld: 1,
    short_chg: 0,
    exchange: 'SHFE',
    ...overrides,
  };
}

function fetchRange(): CommodityHoldingFetchRange {
  const representatives = [representative(), representative({ tradeDate: '20250702' })];
  return {
    productCode: 'CU',
    exchange: 'SHFE',
    referenceContract: 'CU2508.SHF',
    sourceSymbol: 'CU2508',
    startDate: '20250701',
    endDate: '20250702',
    representatives,
  };
}
