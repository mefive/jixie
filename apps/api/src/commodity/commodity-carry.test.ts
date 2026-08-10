import { describe, expect, it } from 'vitest';
import { buildCommodityCarryHistory, type CommodityCarryContractBar } from './commodity-carry.js';

function bar(
  productCode: string,
  tsCode: string,
  tradeDate: string,
  deliveryDate: string,
  settle: number,
  volume = 100,
  openInterest = 1_000,
): CommodityCarryContractBar {
  return {
    productCode,
    tsCode,
    tradeDate,
    deliveryDate,
    settle,
    volume,
    openInterest,
  };
}

describe('commodity carry V1', () => {
  it('uses the nearest two eligible actual contracts and annualizes log carry', () => {
    const points = buildCommodityCarryHistory(
      [
        bar('AU', 'AU2408.SHF', '20240701', '20240705', 550),
        bar('AU', 'AU2409.SHF', '20240701', '20240916', 545),
        bar('AU', 'AU2410.SHF', '20240701', '20241016', 540),
      ],
      { openDates: ['20240702'] },
    );

    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      nearContract: 'AU2409.SHF',
      farContract: 'AU2410.SHF',
      tenorGapDays: 30,
      curveState: 'backwardation',
      nearContractChanged: false,
      availableDate: '20240702',
    });
    expect(points[0].spreadReturn).toBeCloseTo(545 / 540 - 1, 12);
    expect(points[0].annualizedLogCarry).toBeCloseTo(Math.log(545 / 540) * (365 / 30), 12);
  });

  it('marks contango and exposes an actual-contract roll without splicing prices', () => {
    const points = buildCommodityCarryHistory(
      [
        bar('M', 'M2409.DCE', '20240801', '20240913', 3_100),
        bar('M', 'M2411.DCE', '20240801', '20241114', 3_200),
        bar('M', 'M2409.DCE', '20240905', '20240913', 3_050),
        bar('M', 'M2411.DCE', '20240905', '20241114', 3_160),
        bar('M', 'M2501.DCE', '20240905', '20250115', 3_180),
      ],
      { openDates: ['20240802', '20240906'] },
    );

    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({
      nearContract: 'M2409.DCE',
      farContract: 'M2411.DCE',
      curveState: 'contango',
      nearContractChanged: false,
    });
    expect(points[1]).toMatchObject({
      nearContract: 'M2411.DCE',
      farContract: 'M2501.DCE',
      curveState: 'contango',
      nearContractChanged: true,
    });
  });

  it('skips dates without two eligible maturities and rejects duplicate bars', () => {
    expect(
      buildCommodityCarryHistory([bar('CU', 'CU2408.SHF', '20240701', '20240815', 80_000)], {
        openDates: ['20240702'],
      }),
    ).toEqual([]);

    const duplicate = bar('CU', 'CU2408.SHF', '20240701', '20240815', 80_000);
    expect(() =>
      buildCommodityCarryHistory([duplicate, duplicate], { openDates: ['20240702'] }),
    ).toThrow(/Duplicate/);
  });

  it('does not let later contract bars change an already observed curve point', () => {
    const decisionRows = [
      bar('SC', 'SC2409.INE', '20240701', '20240830', 610),
      bar('SC', 'SC2410.INE', '20240701', '20240930', 600),
    ];
    const first = buildCommodityCarryHistory(decisionRows, { openDates: ['20240702'] })[0];
    const withFutureBars = buildCommodityCarryHistory(
      [
        ...decisionRows,
        bar('SC', 'SC2409.INE', '20240702', '20240830', 590),
        bar('SC', 'SC2410.INE', '20240702', '20240930', 620),
      ],
      { openDates: ['20240702', '20240703'] },
    )[0];

    expect(first).toMatchObject({
      asOfDate: '20240701',
      availableDate: '20240702',
      curveState: 'backwardation',
    });
    expect(withFutureBars).toEqual(first);
  });

  it('fails closed when the next SSE trading day is unavailable', () => {
    expect(() =>
      buildCommodityCarryHistory(
        [
          bar('AU', 'AU2409.SHF', '20240701', '20240916', 545),
          bar('AU', 'AU2410.SHF', '20240701', '20241016', 540),
        ],
        { openDates: ['20240701'] },
      ),
    ).toThrow(/No next SSE trading day/);
  });
});
