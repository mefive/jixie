import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateRawMarketDate } from './gate.js';
const checks = vi.hoisted(() => ({ stocks: vi.fn(), indices: vi.fn() }));
vi.mock('#market/stocks/daily-quality.js', () => ({ validateStockDate: checks.stocks }));
vi.mock('#market/indices/daily-quality.js', () => ({ validateIndexDate: checks.indices }));

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

describe('publication quality policy', () => {
  it.each([
    ['30', 30],
    ['invalid', 190],
    ['0', 190],
  ])('passes the configured freshness limit %s to Market', async (configured, expected) => {
    vi.stubEnv('MAINTENANCE_INDEX_WEIGHT_MAX_AGE_DAYS', configured);
    checks.stocks.mockResolvedValue({ daily: 5000 });
    checks.indices.mockResolvedValue({ activeIndustries: 31 });
    expect(await validateRawMarketDate('20260918')).toEqual({
      tradeDate: '20260918',
      daily: 5000,
      activeIndustries: 31,
    });
    expect(checks.indices).toHaveBeenCalledWith('20260918', expected);
  });

  it('propagates a stock quality failure without treating partial data as publishable', async () => {
    checks.stocks.mockRejectedValue(new Error('incomplete stock coverage'));
    await expect(validateRawMarketDate('20260918')).rejects.toThrow('incomplete stock coverage');
    expect(checks.indices).not.toHaveBeenCalled();
  });
});
