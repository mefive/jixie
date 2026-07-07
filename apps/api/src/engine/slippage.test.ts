import { describe, expect, it } from 'vitest';
import type { EngineData } from './data.js';
import { execPrice } from './run.js';
import { DEFAULT_COST } from './types.js';

// A stub EngineData that only answers amountAt (the sole method execPrice touches). `amountThousand` is
// the day's turnover in thousand yuan (as stored), or null for a no-turnover day.
function stubData(amountThousand: number | null): EngineData {
  return { amountAt: () => amountThousand } as unknown as EngineData;
}

const cost = DEFAULT_COST; // slippageBps 2 → base 0.0002; impactCoef 0.1

describe('execPrice — slippage on the fill price', () => {
  it('buys fill above the open, sells below (base half-spread, tiny order → impact ~0)', () => {
    const data = stubData(1_000_000); // 1e6 thousand yuan = 1e9 yuan turnover — an order of ¥1000 barely dents it
    const buy = execPrice(data, '600519.SH', '20200102', 'buy', 100, 1000, cost);
    const sell = execPrice(data, '600519.SH', '20200102', 'sell', 100, 1000, cost);
    expect(buy).toBeGreaterThan(100);
    expect(sell).toBeLessThan(100);
    // impact is negligible here → both ≈ base 0.0002 off the open
    expect(buy).toBeCloseTo(100 * (1 + 0.0002 + 0.1 * (1000 / 1e9)), 6);
    expect(sell).toBeCloseTo(100 * (1 - 0.0002 - 0.1 * (1000 / 1e9)), 6);
  });

  it('a bigger order vs. the day turnover pays more slippage (the small/mid-cap penalty)', () => {
    // Order notional = ¥100k. Thin name: day turnover ¥1e6 → notional/turnover = 0.1 → impact 0.01.
    const thin = execPrice(stubData(1000), 'X', '20200102', 'buy', 100, 100_000, cost); // 1000 thousand yuan = 1e6 yuan
    // Liquid name: same order but ¥1e8 turnover → notional/turnover = 0.001 → impact 0.0001.
    const liquid = execPrice(stubData(100_000), 'X', '20200102', 'buy', 100, 100_000, cost);
    expect(thin).toBeGreaterThan(liquid);
    expect(thin).toBeCloseTo(100 * (1 + 0.0002 + 0.1 * (100_000 / 1e6)), 6); // base + 0.01
    expect(liquid).toBeCloseTo(100 * (1 + 0.0002 + 0.1 * (100_000 / 1e8)), 6);
  });

  it('caps runaway impact at 10% (a giant order in a near-illiquid name)', () => {
    // notional ¥10m vs ¥1e6 turnover → raw impact 1.0; capped to 0.1.
    const buy = execPrice(stubData(1000), 'X', '20200102', 'buy', 100, 10_000_000, cost);
    const sell = execPrice(stubData(1000), 'X', '20200102', 'sell', 100, 10_000_000, cost);
    expect(buy).toBeCloseTo(110, 6); // 100 × 1.10
    expect(sell).toBeCloseTo(90, 6); // 100 × 0.90
  });

  it('no turnover data for the day → base slippage only (impact drops)', () => {
    const buy = execPrice(stubData(null), 'X', '20200102', 'buy', 100, 100_000, cost);
    expect(buy).toBeCloseTo(100 * (1 + 0.0002), 6);
  });
});
