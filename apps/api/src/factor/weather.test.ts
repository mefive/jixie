import { describe, expect, it } from 'vitest';
import {
  FACTOR_WEATHER_METHODOLOGY_HASH,
  factorWeatherMethodology,
  toFactorWeatherPoint,
} from './weather.js';

describe('factor weather', () => {
  it('publishes the fixed monthly methodology used by every card', () => {
    expect(factorWeatherMethodology()).toEqual({
      frequency: 'month',
      neutral: 'size_industry',
      weighting: 'equal',
      groups: 10,
      partialMonth: false,
    });
    expect(FACTOR_WEATHER_METHODOLOGY_HASH).toMatch(/^[a-f0-9]{64}$/);
  });

  it('serializes one offline monthly observation without changing its raw values', () => {
    const point = {
      formationDate: '20240131',
      periodEndDate: '20240229',
      rankIc: 0.04,
      topReturn: 0.03,
      bottomReturn: -0.01,
      longShortGrossReturn: 0.04,
      longShortNetReturn: 0.0365,
      topTurnover: 0.22,
      sampleSize: 3200,
      sampleCoverage: 0.91,
    };

    expect(toFactorWeatherPoint(point)).toEqual(point);
  });
});
