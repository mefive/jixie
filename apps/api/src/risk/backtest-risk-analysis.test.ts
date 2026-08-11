import {
  MARKET_RISK_FACTOR_KEYS_V1,
  type AllocationAnalysis,
  type FactorResearchReportPayloadV1,
  type MarketRiskFactorKeyV1,
  type RiskDataLineageV1,
} from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import type { BacktestResult } from '../engine/types.js';
import { addDays } from '../lib/date.js';
import type { MarketRiskDriverHistoryV1 } from './market-risk-drivers.js';
import { buildBacktestRiskAnalysis } from './backtest-risk-analysis.js';

describe('backtest risk-analysis orchestration', () => {
  it('adds market exposure and scenarios only to a multi-asset result', () => {
    const fixture = input();
    const risk = buildBacktestRiskAnalysis(fixture.result, {
      openDates: fixture.openDates,
      marketHistory: fixture.marketHistory,
      factorReports: new Map(),
    });

    expect(risk?.market).toMatchObject({ observations: 252, explainedVariance: 1 });
    expect(risk?.scenarios?.some((scenario) => scenario.key === 'cn_equity_drawdown_10pct')).toBe(
      true,
    );
    expect(risk?.macro).toBeUndefined();

    fixture.result.allocationAnalysis = undefined;
    expect(
      buildBacktestRiskAnalysis(fixture.result, {
        openDates: fixture.openDates,
        marketHistory: fixture.marketHistory,
        factorReports: new Map(),
      }),
    ).toBeUndefined();
  });

  it('reuses an approved Panel report for Factor-specific overlap', () => {
    const fixture = input();
    const periodObservations = Array.from({ length: 30 }, (_, index) => {
      const formationDate = addDays(fixture.result.start, index * 7);
      const periodEndDate = addDays(formationDate, 6);
      const alignedStart = addDays(formationDate, 1);
      const alignedEnd = addDays(periodEndDate, 1);
      const values = fixture.marketHistory.observations
        .filter((observation) => observation.date > alignedStart && observation.date <= alignedEnd)
        .map((observation) => observation.values.cn_equity!);
      return {
        asOfDate: formationDate,
        targetDate: periodEndDate,
        longShortNetReturn: values.reduce((wealth, value) => wealth * (1 + value), 1) - 1,
      };
    });
    fixture.result.factorDependencies = [
      {
        factorId: 'factor-1',
        key: 'panel_alpha',
        name: 'Panel Alpha',
        analysisKind: 'panel',
        codeHash: 'abc',
        approvedReportId: 'report-1',
      },
    ];
    const factorReports = new Map<string, FactorResearchReportPayloadV1>([
      [
        'report-1',
        {
          version: 1,
          analysisKind: 'panel',
          report: { periodReports: periodObservations } as never,
        },
      ],
    ]);

    const risk = buildBacktestRiskAnalysis(fixture.result, {
      openDates: fixture.openDates,
      marketHistory: fixture.marketHistory,
      factorReports,
    });
    const equityOverlap = risk?.alphaRiskOverlap?.find(
      (overlap) => overlap.marketFactor === 'cn_equity',
    );

    expect(equityOverlap).toMatchObject({
      alphaFactorKey: 'panel_alpha',
      alphaReturnKind: 'net_long_short',
      observations: 30,
      classification: 'dominant',
    });
    expect(equityOverlap?.correlation).toBeCloseTo(1, 12);
  });
});

function input(): {
  result: BacktestResult;
  openDates: string[];
  marketHistory: MarketRiskDriverHistoryV1;
} {
  const start = '20230101';
  const openDates = Array.from({ length: 303 }, (_, index) => addDays(start, index));
  const observations: MarketRiskDriverHistoryV1['observations'] = [];
  const nav = [{ date: start, value: 100 }];
  let value = 100;
  for (let index = 1; index <= 300; index++) {
    const values = Object.fromEntries(
      MARKET_RISK_FACTOR_KEYS_V1.map((factor, factorIndex) => [
        factor,
        factorValue(factor, factorIndex, index),
      ]),
    ) as Record<MarketRiskFactorKeyV1, number>;
    const portfolioReturn = MARKET_RISK_FACTOR_KEYS_V1.reduce(
      (sum, factor, factorIndex) => sum + values[factor] * (0.03 + factorIndex * 0.01),
      0,
    );
    value *= 1 + portfolioReturn;
    nav.push({ date: addDays(start, index), value });
    observations.push({ date: addDays(start, index + 1), values });
  }
  const lineage: RiskDataLineageV1 = {
    dataCutoff: openDates.at(-1)!,
    pointInTimeEligible: true,
    futureVintageRows: 0,
    series: MARKET_RISK_FACTOR_KEYS_V1.map((seriesKey) => ({
      seriesKey,
      availableThrough: observations.at(-1)!.date,
      revisionPolicy: 'not_revised',
    })),
  };
  const result = {
    start,
    end: nav.at(-1)!.date,
    nav,
    allocationAnalysis: {} as AllocationAnalysis,
  } as BacktestResult;
  return {
    result,
    openDates,
    marketHistory: { version: 1, definitions: [], observations, lineage },
  };
}

function factorValue(factor: MarketRiskFactorKeyV1, factorIndex: number, index: number): number {
  const value =
    Math.sin(index * (factorIndex + 1) * 0.071) +
    0.4 * Math.cos((index + 3) * (factorIndex + 2) * 0.037);
  return ['cgb_level', 'cgb_slope', 'cgb_curvature', 'credit_spread', 'us_real_yield'].includes(
    factor,
  )
    ? value
    : value * 0.01;
}
