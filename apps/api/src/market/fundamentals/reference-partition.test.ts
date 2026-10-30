import { describe, expect, it } from 'vitest';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import { acceptSource, seedSessions, capturedAt } from '../../../tests/market-contract-fixtures.js';
import { loadResearchEquityDividends } from '#research/datasets/supplemental.js';

const partition = {
  dataset: 'financial-indicators',
  scope: 'all',
  startDate: '20260630',
  endDate: '20260630',
};
const indicator = {
  ts_code: '688005.SH',
  end_date: '20260630',
  ann_date: '20260831',
  roe: 2,
  roe_waa: null,
  roa: null,
  grossprofit_margin: null,
  netprofit_margin: null,
  debt_to_assets: null,
  or_yoy: null,
  netprofit_yoy: null,
  ocf_to_profit: null,
  update_flag: '0',
};

describe('financial reference maintenance', () => {
  it('deduplicates business versions despite generated IDs and does not rewrite a repeated capture', async () =>
    withSyncDatabase(async (database) => {
      await seedSessions(database, '20260917');
      const source = { call: async () => [indicator, indicator] };
      const first = await acceptSource(database, source, partition);
      expect(first.accepted.rejected).toBe(0);
      expect(await database.finaIndicatorVersion.count()).toBe(1);
      const repeated = await acceptSource(database, source, partition);
      expect(repeated.accepted.changed).toBe(false);
      expect(await database.finaIndicatorVersion.findFirst()).toMatchObject({
        observedAt: capturedAt,
      });
    }));

  it('selects the revised source row and prevents older announcements from overwriting it', async () =>
    withSyncDatabase(async (database) => {
      await seedSessions(database, '20260917');
      const revised = { ...indicator, roe: 3, update_flag: '1' };
      await acceptSource(database, { call: async () => [indicator, revised] }, partition);
      expect(await database.finaIndicator.findFirst()).toMatchObject({ roe: 3 });
      await acceptSource(
        database,
        { call: async () => [{ ...indicator, ann_date: '20260801', roe: 1 }] },
        partition,
      );
      expect(await database.finaIndicator.findFirst()).toMatchObject({ roe: 3 });
      expect(await database.finaIndicatorVersion.count()).toBe(3);
    }));

  it('retains the current snapshot when a same-date change lacks an explicit revision marker', async () =>
    withSyncDatabase(async (database) => {
      await seedSessions(database, '20260917');
      await acceptSource(database, { call: async () => [indicator] }, partition);
      const changed = await acceptSource(
        database,
        { call: async () => [{ ...indicator, roe: 8 }] },
        partition,
      );
      expect(changed.accepted.errors.join(' ')).toContain('Ambiguous same-date');
      expect(await database.finaIndicator.findFirst()).toMatchObject({ roe: 2 });
      expect(await database.finaIndicatorVersion.count()).toBe(2);
    }));

  it('heals an old unknown capture from its own calendar even if the new capture is unknown', async () =>
    withSyncDatabase(async (database) => {
      await acceptSource(
        database,
        { call: async () => [indicator] },
        partition,
        new Date('2026-09-01T10:00:00Z'),
      );
      await seedSessions(database, '20260902');
      await acceptSource(database, { call: async () => [indicator] }, partition);
      expect(await database.finaIndicatorVersion.findFirst()).toMatchObject({
        availableDate: '20260902',
        availabilityQuality: 'latest_only',
        observedAt: new Date('2026-09-01T10:00:00Z'),
      });
    }));

  it('requests dividends by security, preserves unchanged capture time, and exposes the documented pre-tax value', async () =>
    withSyncDatabase(async (database) => {
      await seedSessions(database, '20260917');
      const dividendPartition = {
        dataset: 'dividends',
        scope: '600000.SH',
        startDate: '20140101',
        endDate: '20141231',
      };
      const source = {
        call: async (_api: string, params?: Record<string, unknown>) => {
          expect(params).toEqual({ ts_code: '600000.SH' });
          return [
            {
              ts_code: '600000.SH',
              end_date: '20141231',
              ann_date: '20150516',
              ex_date: '20150623',
              div_proc: '实施',
              cash_div: 0.71915,
              cash_div_tax: 0.757,
            },
          ];
        },
      };
      await acceptSource(database, source, dividendPartition);
      const again = await acceptSource(
        database,
        source,
        dividendPartition,
        new Date('2026-09-18T10:00:00Z'),
      );
      expect(again.accepted.changed).toBe(false);
      const rows = await loadResearchEquityDividends({
        identifier: '600000.SH',
        start: '20260917',
        end: '20260917',
      });
      expect(rows).toEqual(
        expect.arrayContaining([expect.objectContaining({ cash_dividend_pre_tax: 0.757 })]),
      );
    }));
});
