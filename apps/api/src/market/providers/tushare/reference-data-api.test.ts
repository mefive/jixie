import { describe, expect, it, vi } from 'vitest';
import { finaIndicatorVip } from './api.js';
import type { TushareClient } from './client.js';

function fakeClient() {
  const call = vi.fn().mockResolvedValue([]);
  return { call, client: { call } as unknown as TushareClient };
}

describe('Tushare weekly reference-data APIs', () => {
  it('fetches a whole financial report period through the VIP endpoint', async () => {
    const { call, client } = fakeClient();

    await finaIndicatorVip(client, '20260331');

    expect(call).toHaveBeenCalledWith(
      'fina_indicator_vip',
      { period: '20260331', limit: 10_000, offset: 0 },
      expect.stringContaining('update_flag'),
    );
  });

  it('paginates a financial report period that reaches the response limit', async () => {
    const firstPage = Array.from({ length: 10_000 }, () => ({ end_date: '20161231' }));
    const call = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([{ end_date: '20161231' }]);
    const client = { call } as unknown as TushareClient;

    await expect(finaIndicatorVip(client, '20161231')).resolves.toHaveLength(10_001);
    expect(call).toHaveBeenNthCalledWith(
      2,
      'fina_indicator_vip',
      { period: '20161231', limit: 10_000, offset: 10_000 },
      expect.any(String),
    );
  });
});
