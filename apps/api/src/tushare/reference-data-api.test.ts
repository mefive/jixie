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
      { period: '20260331' },
      expect.stringContaining('update_flag'),
    );
  });
});
