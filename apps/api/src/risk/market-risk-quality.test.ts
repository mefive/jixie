import { MARKET_RISK_FACTOR_KEYS_V1 } from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import type { MarketRiskDriverHistoryV1 } from './market-risk-drivers.js';
import { summarizeMarketRiskDriverQuality } from './market-risk-quality.js';

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
