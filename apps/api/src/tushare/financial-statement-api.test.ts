import { describe, expect, it, vi } from 'vitest';

import { balanceSheetVip, incomeStatement } from './api.js';
import type { TushareClient } from './client.js';

describe('Tushare financial statement APIs', () => {
  it('requests the frozen income identity and value fields explicitly', async () => {
    const call = vi.fn().mockResolvedValue([]);
    const client = { call } as unknown as TushareClient;

    await incomeStatement(client, {
      ts_code: '000858.SZ',
      start_date: '20240101',
      end_date: '20241231',
      report_type: '4',
    });

    const fields = String(call.mock.calls[0]?.[2]).split(',');
    expect(call).toHaveBeenCalledWith(
      'income',
      {
        ts_code: '000858.SZ',
        start_date: '20240101',
        end_date: '20241231',
        report_type: '4',
      },
      expect.any(String),
    );
    expect(fields).toEqual(
      expect.arrayContaining([
        'ts_code',
        'ann_date',
        'f_ann_date',
        'end_date',
        'report_type',
        'comp_type',
        'update_flag',
        'revenue',
        'oper_cost',
        'n_income_attr_p',
      ]),
    );
    expect(fields).not.toContain('total_assets');
  });

  it('paginates VIP statement rows until a short page', async () => {
    const firstPage = Array.from({ length: 5_000 }, () => ({ ts_code: '000858.SZ' }));
    const call = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([{ ts_code: '000001.SZ' }]);
    const client = { call } as unknown as TushareClient;

    const rows = await balanceSheetVip(client, '20231231', '5');

    expect(rows).toHaveLength(5_001);
    expect(call).toHaveBeenNthCalledWith(
      1,
      'balancesheet_vip',
      { period: '20231231', report_type: '5', limit: 5_000, offset: 0 },
      expect.any(String),
    );
    expect(call).toHaveBeenNthCalledWith(
      2,
      'balancesheet_vip',
      { period: '20231231', report_type: '5', limit: 5_000, offset: 5_000 },
      expect.any(String),
    );
  });
});
