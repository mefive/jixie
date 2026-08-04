import { describe, expect, it } from 'vitest';
import {
  DAILY_MAINTAINED_INDEX_CODES,
  MAJOR_INDEX_DAILY_BASIC_CODES,
  MAJOR_INDEX_DAILY_CODES,
} from '../store/index-presets.js';
import { buildMarketDateRepairPlan, type MarketDateCounts } from './self-heal.js';

function complete(overrides: Partial<MarketDateCounts> = {}): MarketDateCounts {
  return {
    tradeDate: '20260730',
    daily: 5_500,
    adjustment: 5_500,
    basic: 5_300,
    limits: 5_300,
    moneyflow: 5_100,
    indexDailyCodes: [...DAILY_MAINTAINED_INDEX_CODES],
    indexDailyBasicCodes: [...MAJOR_INDEX_DAILY_BASIC_CODES],
    swIndexDaily: 31,
    ...overrides,
  };
}

describe('market-date self-heal plan', () => {
  it('does nothing to a complete published slice', () => {
    expect(buildMarketDateRepairPlan([complete()])).toEqual([]);
  });

  it('repairs Moneyflow without replacing a valid daily core', () => {
    expect(buildMarketDateRepairPlan([complete({ moneyflow: 0 })])).toEqual([
      expect.objectContaining({
        tradeDate: '20260730',
        core: false,
        moneyflow: true,
        indices: false,
      }),
    ]);
  });

  it('refreshes core and Moneyflow when a dense core table is incomplete', () => {
    expect(buildMarketDateRepairPlan([complete({ adjustment: 100 })])).toEqual([
      expect.objectContaining({
        core: true,
        moneyflow: true,
        indices: false,
      }),
    ]);
  });

  it('detects a Daily row-count cliff against neighboring dates', () => {
    const plan = buildMarketDateRepairPlan([
      complete({ tradeDate: '20260728' }),
      complete({
        tradeDate: '20260729',
        daily: 1_000,
        adjustment: 1_000,
        basic: 1_000,
        limits: 1_000,
      }),
      complete(),
    ]);
    expect(plan).toEqual([
      expect.objectContaining({
        tradeDate: '20260729',
        core: true,
        moneyflow: true,
      }),
    ]);
  });

  it('refreshes both index datasets when a required index row is missing', () => {
    const indexDailyCodes = MAJOR_INDEX_DAILY_CODES.filter((code) => code !== '000300.SH');
    expect(buildMarketDateRepairPlan([complete({ indexDailyCodes })])).toEqual([
      expect.objectContaining({
        core: false,
        moneyflow: false,
        indices: true,
      }),
    ]);
  });

  it('repairs a missing index valuation slice even when index closes are complete', () => {
    expect(buildMarketDateRepairPlan([complete({ indexDailyBasicCodes: [] })])).toEqual([
      expect.objectContaining({
        core: false,
        moneyflow: false,
        indices: true,
      }),
    ]);
  });

  it('repairs an incomplete official SW level-1 industry slice', () => {
    expect(buildMarketDateRepairPlan([complete({ swIndexDaily: 30 })])).toEqual([
      expect.objectContaining({ indices: true }),
    ]);
  });
});
