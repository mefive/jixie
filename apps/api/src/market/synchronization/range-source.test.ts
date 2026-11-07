import { expect, it, vi } from 'vitest';
import { MarketSourceRangeLimitError } from '../errors.js';
import { fetchSourceRange } from './source.js';
import { withImportDiagnostics, type ImportDiagnostics } from './diagnostics.js';

it('uses the ETF endpoint limit and returns one complete wide response', async () => {
  const source = {
    call: vi.fn().mockResolvedValue([{ ts_code: '510000.SH', trade_date: '20221001' }]),
  };
  const response = await fetchSourceRange(
    source,
    'fund_daily',
    {
      ts_code: '510000.SH',
      start_date: '20100101',
      end_date: '20221001',
    },
    'ts_code,trade_date',
    true,
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

it('returns a saturated probe for planning without admitting rows or recording a source failure', async () => {
  const source = { call: vi.fn().mockResolvedValue(Array.from({ length: 2000 }, () => ({}))) };
  const diagnostics: ImportDiagnostics = { requests: [], issues: [] };

  await withImportDiagnostics(diagnostics, async () => {
    await expect(
      fetchSourceRange(
        source,
        'fund_adj',
        {
          ts_code: '510000.SH',
          start_date: '20100101',
          end_date: '20221001',
        },
        'ts_code,trade_date,adj_factor',
        true,
      ),
    ).rejects.toBeInstanceOf(MarketSourceRangeLimitError);
  });
  expect(diagnostics.requests).toHaveLength(1);
  expect(diagnostics.issues).toEqual([]);
});

it('keeps transport failures distinct from saturated responses', async () => {
  const error = new Error('Network offline');
  const source = { call: vi.fn().mockRejectedValue(error) };

  const response = await fetchSourceRange(
    source,
    'fund_adj',
    {
      ts_code: '510000.SH',
      start_date: '20100101',
      end_date: '20221001',
    },
    'ts_code',
    true,
  );

  expect(response).toMatchObject({ complete: false, errors: [error.message] });
});
