import { MARKET_RISK_FACTOR_KEYS_V1 } from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import type { MarketRiskDriverHistoryV1 } from '#market/state/market-risk-drivers.js';
import { summarizeMarketRiskDriverQuality as baseMarketQuality } from '#market/quality/market-risk-drivers.js';
import { summarizeMarketRiskDriverQuality } from './risk-data-audit.js';

describe('market-risk driver quality', () => {
  it('passes a long, current, strictly PIT complete-vector history', () => {
    const dates = Array.from(
      { length: 300 },
      (_, index) => `2024${String(index).padStart(4, '0')}`,
    );
    const history: MarketRiskDriverHistoryV1 = {
      version: 1,
      definitions: [],
      observations: dates.map((date) => ({
        date,
        values: Object.fromEntries(MARKET_RISK_FACTOR_KEYS_V1.map((factor) => [factor, 0.01])),
      })),
      lineage: {
        dataCutoff: dates.at(-1)!,
        pointInTimeEligible: true,
        futureVintageRows: 0,
        series: [],
      },
    };

    expect(summarizeMarketRiskDriverQuality(history, dates)).toMatchObject({
      status: 'pass',
      completeObservations: 300,
      completeCoverage: 1,
      trailingCompleteGaps: 0,
    });
  });

  it('keeps model history gates out of base data quality and preserves audit error order', () => {
    const history: MarketRiskDriverHistoryV1 = {
      version: 1,
      definitions: [],
      observations: [
        {
          date: '20240102',
          values: Object.fromEntries(MARKET_RISK_FACTOR_KEYS_V1.map((factor) => [factor, 0.01])),
        },
      ],
      lineage: {
        dataCutoff: '20240102',
        pointInTimeEligible: true,
        futureVintageRows: 0,
        series: [],
      },
    };
    expect(baseMarketQuality(history, ['20240102'])).toMatchObject({
      lineageErrors: [],
      coverageErrors: [],
      warnings: [],
      completeObservations: 1,
    });
    expect(summarizeMarketRiskDriverQuality(history, ['20240102']).errors).toEqual([
      'only 1 complete observations are available',
    ]);

    history.observations = [];
    history.lineage.pointInTimeEligible = false;
    const summary = summarizeMarketRiskDriverQuality(history, [
      '20240102',
      '20240103',
      '20240104',
      '20240105',
      '20240108',
      '20240109',
    ]);
    expect(summary.errors).toEqual([
      'market-risk driver lineage is not strictly point-in-time eligible',
      'only 0 complete observations are available',
      '6 trailing SSE sessions lack a complete driver vector',
      `missing drivers: ${MARKET_RISK_FACTOR_KEYS_V1.join(', ')}`,
    ]);
  });

  it('requires the full 252-observation audit window, including its exact boundary', () => {
    const dates = Array.from({ length: 252 }, (_, index) => String(20240000 + index));
    const history: MarketRiskDriverHistoryV1 = {
      version: 1,
      definitions: [],
      observations: dates.map((date) => ({
        date,
        values: Object.fromEntries(MARKET_RISK_FACTOR_KEYS_V1.map((factor) => [factor, 0.01])),
      })),
      lineage: {
        dataCutoff: dates.at(-1)!,
        pointInTimeEligible: true,
        futureVintageRows: 0,
        series: [],
      },
    };
    expect(summarizeMarketRiskDriverQuality(history, dates).status).toBe('pass');
    history.observations.pop();
    expect(summarizeMarketRiskDriverQuality(history, dates).errors).toEqual([
      'only 251 complete observations are available',
    ]);
  });

  it('fails when the common history is short or not point-in-time eligible', () => {
    const history: MarketRiskDriverHistoryV1 = {
      version: 1,
      definitions: [],
      observations: [],
      lineage: {
        dataCutoff: '20240101',
        pointInTimeEligible: false,
        futureVintageRows: 1,
        series: [],
      },
    };

    const summary = summarizeMarketRiskDriverQuality(history, ['20240101']);

    expect(summary.status).toBe('error');
    expect(summary.errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/point-in-time/)]),
    );
  });
});
