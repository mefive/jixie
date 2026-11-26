import { expect, it, vi } from 'vitest';
import { fetchSourcePages } from './source.js';
import { withImportDiagnostics, type ImportDiagnostics } from './diagnostics.js';

it('uses the ETF endpoint limit and returns one complete wide response', async () => {
  const source = {
    call: vi.fn().mockResolvedValue([{ ts_code: '510000.SH', trade_date: '20221001' }]),
  };
  const response = await fetchSourcePages(
    source,
    'fund_daily',
    {
      ts_code: '510000.SH',
      start_date: '20100101',
      end_date: '20221001',
    },
    'ts_code,trade_date',
  );

  expect(response).toMatchObject({ complete: true, pages: 1 });
  expect(source.call).toHaveBeenCalledTimes(1);
  expect(source.call).toHaveBeenCalledWith(
    'fund_daily',
    {
      ts_code: '510000.SH',
      start_date: '20100101',
      end_date: '20221001',
      limit: 5000,
      offset: 0,
    },
    'ts_code,trade_date',
  );
});

it('pages a full adjustment window without changing its logical receipt', async () => {
  const source = {
    call: vi
      .fn()
      .mockResolvedValueOnce(Array.from({ length: 2000 }, (_, i) => ({ ts_code: String(i) })))
      .mockResolvedValueOnce([]),
  };
  const diagnostics: ImportDiagnostics = { requests: [], issues: [] };
  const params = { ts_code: '510000.SH', start_date: '20000101', end_date: '20250101' };
  const fields = 'ts_code,trade_date,adj_factor';
  const result = await withImportDiagnostics(diagnostics, () =>
    fetchSourcePages(source, 'fund_adj', params, fields),
  );
  expect(result).toMatchObject({ complete: true, pages: 2 });
  expect(source.call).toHaveBeenNthCalledWith(
    2,
    'fund_adj',
    { ...params, limit: 2000, offset: 2000 },
    fields,
  );
  expect(diagnostics.requests).toEqual([{ api: 'fund_adj', params, fields }]);
  expect(diagnostics.issues).toEqual([]);
});

it('keeps transport failures distinct from saturated responses', async () => {
  const error = new Error('Network offline');
  const source = { call: vi.fn().mockRejectedValue(error) };

  const response = await fetchSourcePages(
    source,
    'fund_adj',
    {
      ts_code: '510000.SH',
      start_date: '20100101',
      end_date: '20221001',
    },
    'ts_code',
  );

  expect(response).toMatchObject({
    complete: false,
    errors: ['fund_adj offset=0: Network offline'],
  });
});
