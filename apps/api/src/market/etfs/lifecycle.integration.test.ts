import { describe, expect, it } from 'vitest';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import { planIngestion } from '#ingestion/plan.js';
import { listDownloads } from '../downloads/lists.js';
import { etfDownloadRange } from './download-range.js';

describe('ETF ingestion lifecycle', () => {
  it.each([null, '20260230', '20260831'])('does not invent a delisting date: %s', (delistDate) => {
    expect(
      etfDownloadRange({ listStatus: 'D', listDate: '20260901', delistDate }, '19901219'),
    ).toMatchObject({ blockedReason: expect.any(String) });
  });
  it('bounds delisted instruments and reports only blocked selections', async () =>
    withSyncDatabase(async (database) => {
      const codes = ['510000.SH', '510001.SH', '510002.SH', '510003.SH'];
      await database.ingestionSelection.createMany({
        data: [
          { assetType: 'etf', codes },
          { assetType: 'index', codes: [] },
        ],
      });
      await database.etfBasic.createMany({
        data: codes.map((tsCode, index) => ({
          tsCode,
          name: tsCode,
          listDate: '20260901',
          listStatus: ['L', 'D', 'D', 'P'][index],
          exchange: 'SH',
          sameDayTurnover: false,
          delistDate: index === 1 ? '20260911' : null,
        })),
      });
      const plan = await planIngestion('20260915', new Date('2026-10-29T10:00:00Z'));
      const units = plan.units.filter((unit) => unit.dataset === 'etf-prices');
      expect(units.map((unit) => [unit.scope, unit.startDate, unit.endDate])).toEqual([
        [codes[0], '20260901', '20260915'],
        [codes[1], '20260901', '20260911'],
      ]);
      expect(plan.blocked.map((entry) => entry.scope)).toEqual([codes[2], codes[3]]);
      expect((await listDownloads('etf')).rows.map((row) => row.tsCode)).toEqual(codes);
    }));
});
