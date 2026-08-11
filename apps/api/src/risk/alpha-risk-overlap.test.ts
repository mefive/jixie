import {
  MARKET_RISK_FACTOR_KEYS_V1,
  type FactorResearchReportPayloadV1,
  type MarketRiskFactorKeyV1,
  type RiskDataLineageV1,
} from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import { addDays } from '../lib/date.js';
import type { MarketRiskDriverHistoryV1 } from './market-risk-drivers.js';
import {
  alignAlphaPeriodReturnsToRiskAvailability,
  alphaPeriodsFromFactorReport,
  analyzeAlphaRiskOverlap,
  classifyAlphaRiskOverlap,
  type AlphaPeriodReturnObservation,
} from './alpha-risk-overlap.js';

describe('Alpha and market-risk overlap', () => {
  it('identifies a dominant market driver over exactly aligned Alpha periods', () => {
    const { history, periods } = fixture(30);
    const report = analyzeAlphaRiskOverlap('value_alpha', periods, history);
    const equity = report.find((row) => row.marketFactor === 'cn_equity');

    expect(equity).toMatchObject({
      alphaFactorKey: 'value_alpha',
      alphaReturnKind: 'net_long_short',
      observations: 30,
      classification: 'dominant',
    });
    expect(equity?.correlation).toBeCloseTo(1, 12);
  });

  it('omits unavailable drivers rather than classifying missing values as low overlap', () => {
    const { history, periods } = fixture(30);
    for (const observation of history.observations) {
      delete observation.values.gold;
    }

    const report = analyzeAlphaRiskOverlap('carry_alpha', periods, history);

    expect(report.some((row) => row.marketFactor === 'gold')).toBe(false);
    expect(report.some((row) => row.marketFactor === 'cn_equity')).toBe(true);
  });

  it('rejects non-PIT market lineage instead of producing a diagnostic', () => {
    const { history, periods } = fixture(30);
    history.lineage.pointInTimeEligible = false;

    expect(analyzeAlphaRiskOverlap('alpha', periods, history)).toEqual([]);
  });

  it('shifts raw factor-report periods to next-session availability boundaries', () => {
    expect(
      alignAlphaPeriodReturnsToRiskAvailability(
        [{ formationDate: '20240105', periodEndDate: '20240108', return: 0.02 }],
        ['20240105', '20240108', '20240109'],
      ),
    ).toEqual([{ startDate: '20240108', endDate: '20240109', return: 0.02 }]);
  });

  it('reuses net long-short periods from frozen cross-sectional and Panel reports', () => {
    const crossSectional = {
      version: 1,
      analysisKind: 'cross_sectional',
      report: {
        periodObservations: [
          {
            formationDate: '20240102',
            periodEndDate: '20240131',
            longShortNetReturn: 0.03,
          },
        ],
      },
    } as unknown as FactorResearchReportPayloadV1;
    const panel = {
      version: 1,
      analysisKind: 'panel',
      report: {
        periodReports: [
          {
            asOfDate: '20240102',
            targetDate: '20240131',
            longShortNetReturn: 0.04,
          },
        ],
      },
    } as unknown as FactorResearchReportPayloadV1;

    expect(alphaPeriodsFromFactorReport(crossSectional)[0]?.return).toBe(0.03);
    expect(alphaPeriodsFromFactorReport(panel)[0]?.return).toBe(0.04);
  });

  it('uses absolute correlation for frozen low, material, and dominant bands', () => {
    expect(classifyAlphaRiskOverlap(0.19)).toBe('low');
    expect(classifyAlphaRiskOverlap(-0.2)).toBe('material');
    expect(classifyAlphaRiskOverlap(-0.5)).toBe('dominant');
  });
});

function fixture(length: number): {
  history: MarketRiskDriverHistoryV1;
  periods: AlphaPeriodReturnObservation[];
} {
  const observations: MarketRiskDriverHistoryV1['observations'] = [];
  const periods = Array.from({ length }, (_, periodIndex) => {
    const startDate = addDays('20200101', periodIndex * 7);
    const endDate = addDays(startDate, 6);
    const dailyEquityReturns: number[] = [];
    for (let dayIndex = 1; dayIndex <= 6; dayIndex++) {
      const date = addDays(startDate, dayIndex);
      const values = Object.fromEntries(
        MARKET_RISK_FACTOR_KEYS_V1.map((factor, factorIndex) => {
          const value = driverValue(factor, factorIndex, periodIndex, dayIndex);
          if (factor === 'cn_equity') {
            dailyEquityReturns.push(value);
          }
          return [factor, value];
        }),
      ) as Record<MarketRiskFactorKeyV1, number>;
      observations.push({ date, values });
    }
    return {
      startDate,
      endDate,
      return: dailyEquityReturns.reduce((wealth, value) => wealth * (1 + value), 1) - 1,
    };
  });
  const lineage: RiskDataLineageV1 = {
    dataCutoff: periods.at(-1)!.endDate,
    pointInTimeEligible: true,
    futureVintageRows: 0,
    series: [],
  };
  return { history: { version: 1, definitions: [], observations, lineage }, periods };
}

function driverValue(
  factor: MarketRiskFactorKeyV1,
  factorIndex: number,
  periodIndex: number,
  dayIndex: number,
): number {
  const value =
    Math.sin((periodIndex + 1) * (factorIndex + 1) * 0.31) +
    0.3 * Math.cos((periodIndex + 2) * (factorIndex + 2) * 0.17) +
    dayIndex * 0.01;
  return ['cgb_level', 'cgb_slope', 'cgb_curvature', 'credit_spread', 'us_real_yield'].includes(
    factor,
  )
    ? value
    : value * 0.001;
}
