import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import { acceptSource, seedSessions } from '../../../tests/market-contract-fixtures.js';
import { loadIndicatorVersions } from './indicator-versions.js';
import { loadResearchEquityFundamentals } from '#research/datasets/supplemental.js';

const partition = {
  dataset: 'financial-indicators',
  scope: 'all',
  startDate: '20180331',
  endDate: '20180331',
};
const oldSource = {
  ts_code: '000022.SZ',
  end_date: '20180331',
  ann_date: '20180427',
  roe: 3.1757,
  roa: 3.119,
  roe_waa: 2.91,
  update_flag: '1',
};
const newSource = { ...oldSource, ts_code: '001872.SZ', roe: 0.8946, roa: 0.4288 };

describe('financial indicator source succession', () => {
  it.each([
    ['000022.SZ', '001872.SZ', '20180331', '20180427', 3.1757, 0.8946, 3.119, 0.4288],
    ['000022.SZ', '001872.SZ', '20180630', '20180831', 6.7196, 1.9179, 6.9869, 0.9024],
    ['000022.SZ', '001872.SZ', '20180930', '20181031', 9.4947, 2.7386, 9.8757, 1.2745],
    ['000043.SZ', '001914.SZ', '20180930', '20181031', 18.2093, 18.2093, 6.6145, 6.595],
    ['000043.SZ', '001914.SZ', '20190331', '20190427', 1.1305, 1.1305, 1.0244, 1.0144],
    ['000043.SZ', '001914.SZ', '20190930', '20191031', 2.8764, 2.8764, 2.9574, 2.928],
  ] as const)(
    'resolves the observed source collision %s → %s / %s',
    async (oldCode, newCode, period, announcement, oldRoe, newRoe, oldRoa, newRoa) =>
      withSyncDatabase(async (database) => {
        await seedSessions(database, '20260917');
        const window = { ...partition, startDate: period, endDate: period };
        const previous = {
          ...oldSource,
          ts_code: oldCode,
          end_date: period,
          ann_date: announcement,
          roe: oldRoe,
          roa: oldRoa,
        };
        const successor = { ...previous, ts_code: newCode, roe: newRoe, roa: newRoa };
        await acceptSource(database, { call: async () => [previous] }, window);

        const result = await acceptSource(
          database,
          { call: async () => [previous, successor] },
          window,
        );
        expect(result.prepared.status).toBe('complete');
        expect(result.accepted.errors).toEqual([]);
        expect(await database.finaIndicator.findFirst()).toMatchObject({
          sourceTsCode: newCode,
          roe: newRoe,
          roa: newRoa,
        });
        expect(await loadIndicatorVersions()).toMatchObject([
          { sourceTsCode: newCode, roe: newRoe, roa: newRoa },
        ]);
        expect(await database.finaIndicatorVersion.count()).toBe(2);
      }),
  );

  it.each([false, true])(
    'selects source before announcement and revision, reversed=%s',
    async (reversed) =>
      withSyncDatabase(async (database) => {
        await seedSessions(database, '20260917');
        const olderCode = { ...oldSource, ann_date: '20180501' };
        await acceptSource(database, { call: async () => [olderCode] }, partition);
        const preferred = { ...newSource, update_flag: '0', roe_waa: null };
        const rows = [olderCode, preferred];

        const result = await acceptSource(
          database,
          {
            call: async () => (reversed ? [...rows].reverse() : rows),
          },
          partition,
        );
        expect(result.prepared.errors).toEqual([]);
        expect(result.accepted.errors).toEqual([]);
        expect(await database.finaIndicator.findFirst()).toMatchObject({
          sourceTsCode: '001872.SZ',
          annDate: '20180427',
          roe: 0.8946,
          roeWaa: null,
        });
        const versions = await database.finaIndicatorVersion.findMany();
        expect(versions).toHaveLength(2);
        expect(versions).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ sourceTsCode: '000022.SZ', updateFlag: '1' }),
            expect.objectContaining({ sourceTsCode: '001872.SZ', updateFlag: '0' }),
          ]),
        );

        const repeated = await acceptSource(database, { call: async () => rows }, partition);
        expect(repeated.accepted.changed).toBe(false);
      }),
  );

  it('falls back independently for a report period absent under the successor code', async () =>
    withSyncDatabase(async (database) => {
      await seedSessions(database, '20260917');
      await acceptSource(database, { call: async () => [newSource] }, partition);
      const nextPeriod = { ...partition, startDate: '20180630', endDate: '20180630' };
      const result = await acceptSource(
        database,
        {
          call: async () => [{ ...oldSource, end_date: '20180630', ann_date: '20180831' }],
        },
        nextPeriod,
      );

      expect(result.prepared.status).toBe('complete');
      expect(await database.finaIndicator.findMany({ orderBy: { endDate: 'asc' } })).toMatchObject([
        { endDate: '20180331', sourceTsCode: '001872.SZ' },
        { endDate: '20180630', sourceTsCode: '000022.SZ' },
      ]);
    }));

  it('retains a known successor across later old-code captures and narrow date queries', async () =>
    withSyncDatabase(async (database) => {
      await seedSessions(database, '20260917', '20260919');
      await acceptSource(database, { call: async () => [oldSource] }, partition);
      await acceptSource(
        database,
        { call: async () => [newSource] },
        partition,
        new Date('2026-09-17T10:00:00Z'),
      );
      await acceptSource(
        database,
        { call: async () => [{ ...oldSource, roe: 9 }] },
        partition,
        new Date('2026-09-18T10:00:00Z'),
      );

      expect(await database.finaIndicator.findFirst()).toMatchObject({
        sourceTsCode: '001872.SZ',
        roe: 0.8946,
      });
      expect(await loadIndicatorVersions({ endDate: '20260917' })).toMatchObject([
        { sourceTsCode: '000022.SZ', roe: 3.1757, availableDate: '20260917' },
      ]);
      expect(await loadIndicatorVersions({ endDate: '20260919' })).toMatchObject([
        { sourceTsCode: '000022.SZ', availableDate: '20260917' },
        { sourceTsCode: '001872.SZ', availableDate: '20260918' },
      ]);
      expect(await loadIndicatorVersions({ startDate: '20260919', endDate: '20260919' })).toEqual(
        [],
      );
      expect(await database.finaIndicatorVersion.count()).toBe(3);
    }));

  it('keeps legacy provenance unknown until a fresh source is available', async () =>
    withSyncDatabase(async (database) => {
      await seedSessions(database, '20260917');
      const legacy = { tsCode: '001872.SZ', endDate: '20180331', annDate: '20180427', roe: 3.1757 };
      await database.finaIndicator.create({ data: legacy });
      await database.finaIndicatorVersion.create({
        data: {
          ...legacy,
          id: 'legacy',
          sourceFingerprint: 'legacy',
          observedAt: new Date('2026-09-14T10:00:00Z'),
          availableDate: '20260915',
          availabilityQuality: 'latest_only',
        },
      });

      await acceptSource(
        database,
        { call: async () => [{ ...newSource, update_flag: '0' }] },
        partition,
      );
      expect(await database.finaIndicator.findFirst()).toMatchObject({
        sourceTsCode: '001872.SZ',
        roe: 0.8946,
      });
      expect(
        await database.finaIndicatorVersion.findUnique({ where: { id: 'legacy' } }),
      ).toMatchObject({
        sourceTsCode: null,
        updateFlag: null,
        availableDate: '20260915',
        roe: 3.1757,
      });
      expect(await loadIndicatorVersions({ endDate: '20260916' })).toMatchObject([{ roe: 3.1757 }]);
      const visible = await loadResearchEquityFundamentals({
        identifier: '001872.SZ',
        start: '20260917',
        end: '20260917',
      });
      expect(visible).toMatchObject([{ date: '20260917', roe_pct: 0.8946 }]);
    }));

  it('rejects invalid successor metrics while retaining a valid fallback', async () =>
    withSyncDatabase(async (database) => {
      await seedSessions(database, '20260917');
      const result = await acceptSource(
        database,
        {
          call: async () => [oldSource, { ...newSource, roe: 'invalid' }],
        },
        partition,
      );

      expect(result.prepared.status).toBe('error');
      expect(await database.finaIndicator.findFirst()).toMatchObject({
        sourceTsCode: '000022.SZ',
        roe: 3.1757,
      });
      expect(await database.finaIndicatorVersion.count()).toBe(1);
    }));

  it('reports preferred-source conflicts instead of falling back', async () =>
    withSyncDatabase(async (database) => {
      await seedSessions(database, '20260917');
      const result = await acceptSource(
        database,
        {
          call: async () => [oldSource, newSource, { ...newSource, roe: 8 }],
        },
        partition,
      );

      expect(result.prepared.status).toBe('error');
      expect(await database.finaIndicator.count()).toBe(0);
      expect(await database.finaIndicatorVersion.count()).toBe(3);
      expect(await loadIndicatorVersions()).toEqual([]);
    }));

  it('keeps revision flags separate and selects the revised row in consumer reads', async () =>
    withSyncDatabase(async (database) => {
      await seedSessions(database, '20260917');
      const result = await acceptSource(
        database,
        {
          call: async () => [{ ...newSource, roe: 2, update_flag: '0' }, newSource],
        },
        partition,
      );

      expect(result.prepared.status).toBe('complete');
      expect(await database.finaIndicatorVersion.count()).toBe(2);
      expect(await loadIndicatorVersions()).toMatchObject([{ roe: 0.8946, updateFlag: '1' }]);
      expect(await loadIndicatorVersions()).toHaveLength(1);
    }));

  it('preserves legacy metrics on null refreshes for unchanged identities', async () =>
    withSyncDatabase(async (database) => {
      await seedSessions(database, '20260917');
      await database.finaIndicator.create({
        data: {
          tsCode: '600549.SH',
          endDate: '20180331',
          annDate: '20180427',
          roeWaa: 6.24,
        },
      });

      await acceptSource(
        database,
        {
          call: async () => [
            {
              ...newSource,
              ts_code: '600549.SH',
              roe_waa: null,
            },
          ],
        },
        partition,
      );
      expect(await database.finaIndicator.findFirst()).toMatchObject({
        sourceTsCode: '600549.SH',
        roeWaa: 6.24,
      });
    }));

  it.each(['older announcement', 'unmarked revision'])(
    'keeps legacy protection for an unchanged code: %s',
    async (scenario) =>
      withSyncDatabase(async (database) => {
        await seedSessions(database, '20260917');
        await database.finaIndicator.create({
          data: {
            tsCode: '600549.SH',
            endDate: '20180331',
            roe: 9,
            annDate: scenario === 'older announcement' ? '20180501' : '20180427',
          },
        });

        const result = await acceptSource(
          database,
          {
            call: async () => [
              {
                ...newSource,
                ts_code: '600549.SH',
                update_flag: '0',
              },
            ],
          },
          partition,
        );
        expect(result.accepted.rejected).toBe(scenario === 'older announcement' ? 0 : 1);
        expect(await database.finaIndicator.findFirst()).toMatchObject({
          roe: 9,
          sourceTsCode: null,
        });
      }),
  );

  it('combines missing fields for consumers while preserving source records', async () =>
    withSyncDatabase(async (database) => {
      await seedSessions(database, '20260917');
      await acceptSource(
        database,
        {
          call: async () => [
            { ...newSource, roe: null },
            { ...newSource, roe_waa: null },
          ],
        },
        partition,
      );

      expect(await loadIndicatorVersions()).toMatchObject([{ roe: 0.8946, roeWaa: 2.91 }]);
      expect(await database.finaIndicatorVersion.findMany()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ roe: null, roeWaa: 2.91 }),
          expect.objectContaining({ roe: 0.8946, roeWaa: null }),
        ]),
      );
    }));
});

it('adds nullable provenance while retaining rows and unrelated tables', async () => {
  const migration = await readFile(
    new URL(
      '../../../prisma/migrations/20261030100000_indicator_source_selection/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  const database = new DatabaseSync(':memory:');
  try {
    database.exec(`
      CREATE TABLE FinaIndicator (tsCode TEXT, endDate TEXT, roe REAL);
      CREATE TABLE FinaIndicatorVersion (id TEXT, sourceFingerprint TEXT, observedAt TEXT);
      CREATE TABLE SavedDocument (id TEXT, content TEXT);
      INSERT INTO FinaIndicator VALUES ('001872.SZ', '20180331', 3.1757);
      INSERT INTO FinaIndicatorVersion VALUES ('legacy', 'original-hash', '2026-09-14');
      INSERT INTO SavedDocument VALUES ('document', 'retained');
    `);
    database.exec(migration);

    expect(database.prepare('SELECT * FROM FinaIndicator').get()).toEqual({
      tsCode: '001872.SZ',
      endDate: '20180331',
      roe: 3.1757,
      sourceTsCode: null,
    });
    expect(database.prepare('SELECT * FROM FinaIndicatorVersion').get()).toEqual({
      id: 'legacy',
      sourceFingerprint: 'original-hash',
      observedAt: '2026-09-14',
      sourceTsCode: null,
      updateFlag: null,
    });
    expect(database.prepare('SELECT * FROM SavedDocument').get()).toEqual({
      id: 'document',
      content: 'retained',
    });
  } finally {
    database.close();
  }
});
