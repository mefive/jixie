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
  it.each([
    ['300553.SZ', '20260331', '20260819', 0.78],
    ['600549.SH', '20260331', '20260429', 6.24],
    ['688075.SH', '20260331', '20260803', -0.2],
    ['600638.SH', '20251231', '20260424', 1.5],
    ['688162.SH', '20251231', '20260430', 3.36],
  ] as const)(
    'retains a known weighted ROE when the source returns null: %s/%s',
    async (tsCode, endDate, annDate, weightedRoe) =>
      withSyncDatabase(async (database) => {
        await seedSessions(database, '20260917');
        const window = { ...partition, startDate: endDate, endDate };
        const row = { ...indicator, ts_code: tsCode, end_date: endDate, ann_date: annDate };
        await acceptSource(
          database,
          { call: async () => [{ ...row, roe_waa: weightedRoe }] },
          window,
        );

        const source = { call: async () => [row] };
        const result = await acceptSource(database, source, window);
        expect(result.prepared.status).toBe('complete');
        expect(result.accepted.errors).toEqual([]);
        expect(result.accepted.rejected).toBe(0);
        expect(result.accepted.updated).toBe(0);
        expect(await database.finaIndicator.findFirst()).toMatchObject({ roeWaa: weightedRoe });
        expect(await database.finaIndicatorVersion.findMany()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ roeWaa: weightedRoe }),
            expect.objectContaining({ roeWaa: null }),
          ]),
        );

        const repeated = await acceptSource(database, source, window);
        expect(repeated.accepted.changed).toBe(false);
        expect(repeated.accepted.errors).toEqual([]);
        expect(await database.finaIndicatorVersion.count()).toBe(2);
      }),
  );

  it('preserves an omitted field and fills a missing metric with zero without a revision marker', async () =>
    withSyncDatabase(async (database) => {
      await seedSessions(database, '20260917');
      await acceptSource(
        database,
        { call: async () => [{ ...indicator, roe: null, roe_waa: 2 }] },
        partition,
      );
      const { roe_waa: _weightedRoe, ...row } = indicator;

      const source = { call: async () => [{ ...row, roe: 0 }] };
      const result = await acceptSource(database, source, partition);
      expect(result.accepted.errors).toEqual([]);
      expect(result.accepted.updated).toBe(1);
      expect(await database.finaIndicator.findFirst()).toMatchObject({ roe: 0, roeWaa: 2 });
      expect(await database.finaIndicatorVersion.findMany()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ roe: null, roeWaa: 2 }),
          expect.objectContaining({ roe: 0, roeWaa: null }),
        ]),
      );

      const repeated = await acceptSource(database, source, partition);
      expect(repeated.accepted.changed).toBe(false);
      expect(repeated.accepted.errors).toEqual([]);
    }));

  it.each(['0', '1'])(
    'treats zero as a changed known value and respects the revision marker: %s',
    async (updateFlag) =>
      withSyncDatabase(async (database) => {
        await seedSessions(database, '20260917');
        await acceptSource(database, { call: async () => [indicator] }, partition);

        const result = await acceptSource(
          database,
          { call: async () => [{ ...indicator, roe: 0, update_flag: updateFlag }] },
          partition,
        );
        expect(result.accepted.rejected).toBe(updateFlag === '1' ? 0 : 1);
        expect(await database.finaIndicator.findFirst()).toMatchObject({
          roe: updateFlag === '1' ? 0 : 2,
        });
        expect(await database.finaIndicatorVersion.count()).toBe(2);
      }),
  );

  it.each([false, true])(
    'combines complementary source rows without inventing a combined source version, reversed=%s',
    async (reversed) =>
      withSyncDatabase(async (database) => {
        await seedSessions(database, '20260917');
        const { roe_waa: _weightedRoe, ...withoutWeightedRoe } = indicator;
        const rows = [
          { ...withoutWeightedRoe, roe: 0 },
          { ...indicator, roe: null, roe_waa: 2 },
        ];
        const source = { call: async () => (reversed ? [...rows].reverse() : rows) };

        const result = await acceptSource(database, source, partition);
        expect(result.prepared.status).toBe('complete');
        expect(result.prepared.errors).toEqual([]);
        expect(result.accepted.errors).toEqual([]);
        expect(await database.finaIndicator.findFirst()).toMatchObject({ roe: 0, roeWaa: 2 });
        const versions = await database.finaIndicatorVersion.findMany();
        expect(versions).toHaveLength(2);
        expect(versions).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ roe: 0, roeWaa: null }),
            expect.objectContaining({ roe: null, roeWaa: 2 }),
          ]),
        );

        const repeated = await acceptSource(database, source, partition);
        expect(repeated.accepted.changed).toBe(false);
        expect(repeated.accepted.errors).toEqual([]);
      }),
  );

  it.each([false, true])(
    'retains a same-priority conflict despite a complementary row, reversed=%s',
    async (reversed) =>
      withSyncDatabase(async (database) => {
        await seedSessions(database, '20260917');
        const rows = [
          { ...indicator, roe: 0 },
          { ...indicator, roe: null, roe_waa: 2 },
          { ...indicator, roe: 3 },
        ];

        const result = await acceptSource(
          database,
          { call: async () => (reversed ? [...rows].reverse() : rows) },
          partition,
        );
        expect(result.prepared.status).toBe('error');
        expect(result.prepared.errors.join(' ')).toContain('Ambiguous current indicator version');
        expect(await database.finaIndicator.count()).toBe(0);
        expect(await database.finaIndicatorVersion.count()).toBe(3);
      }),
  );

  it.each(['announcement', 'revision'])(
    'resolves a lower-priority source conflict using a later %s',
    async (priority) =>
      withSyncDatabase(async (database) => {
        await seedSessions(database, '20260917');
        const preferred = {
          ...indicator,
          roe: 4,
          ann_date: priority === 'announcement' ? '20260901' : indicator.ann_date,
          update_flag: priority === 'revision' ? '1' : '0',
        };

        const result = await acceptSource(
          database,
          { call: async () => [indicator, { ...indicator, roe: 3 }, preferred] },
          partition,
        );
        expect(result.prepared.status).toBe('complete');
        expect(result.prepared.errors).toEqual([]);
        expect(result.accepted.errors).toEqual([]);
        expect(await database.finaIndicator.findFirst()).toMatchObject({ roe: 4 });
        expect(await database.finaIndicatorVersion.count()).toBe(3);
      }),
  );

  it.each([false, true])(
    'prefers the successor source while retaining both business versions, reversed=%s',
    async (reversed) =>
      withSyncDatabase(async (database) => {
        await seedSessions(database, '20260917');
        const window = { ...partition, startDate: '20180331', endDate: '20180331' };
        const previousCode = {
          ...indicator,
          ts_code: '000022.SZ',
          end_date: '20180331',
          ann_date: '20180427',
          roe: 3.1757,
          roe_waa: 2.91,
          roa: 3.119,
          update_flag: '1',
        };
        await acceptSource(database, { call: async () => [previousCode] }, window);
        const successorCode = { ...previousCode, ts_code: '001872.SZ', roe: 0.8946, roa: 0.4288 };
        const rows = [previousCode, successorCode];

        const result = await acceptSource(
          database,
          { call: async () => (reversed ? [...rows].reverse() : rows) },
          window,
        );
        expect(result.prepared.status).toBe('complete');
        expect(result.prepared.errors).toEqual([]);
        expect(result.accepted.updated).toBe(1);
        expect(await database.finaIndicator.findFirst()).toMatchObject({
          tsCode: '001872.SZ',
          sourceTsCode: '001872.SZ',
          roe: 0.8946,
          roa: 0.4288,
        });
        expect(await database.finaIndicatorVersion.count()).toBe(2);
      }),
  );

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
