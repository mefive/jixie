import { describe, expect, it, vi } from 'vitest';
import { nameChange, stockBasic } from './api.js';
import type { TushareClient } from './client.js';

function fakeClient() {
  const call = vi.fn().mockResolvedValue([]);
  return { call, client: { call } as unknown as TushareClient };
}

describe('Tushare stock-reference APIs', () => {
  it('requests lifecycle fields for an explicit listing status', async () => {
    const { call, client } = fakeClient();

    await stockBasic(client, { list_status: 'D' });

    expect(call).toHaveBeenCalledWith(
      'stock_basic',
      { list_status: 'D' },
      expect.stringContaining('delist_date'),
    );
  });

  it('requests point-in-time historical name spells by announcement range', async () => {
    const { call, client } = fakeClient();
    const params = { start_date: '20200101', end_date: '20201231' } as const;

    await nameChange(client, params);

    expect(call).toHaveBeenCalledWith(
      'namechange',
      params,
      'ts_code,name,start_date,end_date,ann_date,change_reason',
    );
  });
});
