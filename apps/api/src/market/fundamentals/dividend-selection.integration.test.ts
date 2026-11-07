import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import { acceptSource, capturedAt } from '../../../tests/market-contract-fixtures.js';
import { withImportDiagnostics } from '../synchronization/diagnostics.js';
import type { ImportDiagnostics } from '../synchronization/diagnostics.js';

const partition = {
  dataset: 'dividends',
  scope: '000002.SZ',
  startDate: '',
  endDate: '20181231',
};
const original = {
  ts_code: '000002.SZ',
  end_date: '20181231',
  ann_date: '20190326',
  ex_date: '20190509',
  div_proc: '实施',
  cash_div: 1.07,
  cash_div_tax: 1.07,
  base_date: '20181231',
  base_share: 1103915.2001,
};
const adjusted = {
  ...original,
  cash_div: 1.045102,
  cash_div_tax: 1.045102,
  base_date: '20190409',
  base_share: 1130214.3001,
};

it.each([false, true])(
  'accepts the newer Vanke base regardless of response order: reversed=%s',
  async (reversed) =>
    withSyncDatabase(async (database) => {
      const diagnostics: ImportDiagnostics = { requests: [], issues: [] };
      const first = await withImportDiagnostics(diagnostics, () =>
        acceptSource(
          database,
          {
            call: async (_api, _params, fields) => {
              expect(fields).toContain('base_date');
              expect(fields).toContain('base_share');

              return reversed ? [original, adjusted] : [adjusted, original];
            },
          },
          partition,
        ),
      );
      expect(first.prepared.checks).toMatchObject({ sourceRows: 2, excludedRows: 1 });
      expect(first.accepted).toMatchObject({ inserted: 1, rejected: 0, errors: [] });
      expect(diagnostics.issues).toEqual([]);
      expect(await database.dividend.findFirstOrThrow()).toMatchObject({
        annDate: original.ann_date,
        baseDate: adjusted.base_date,
        baseShare: adjusted.base_share,
        cashDivTax: adjusted.cash_div_tax,
        availabilityQuality: 'latest_only',
      });
      const saved = await database.dividend.findFirstOrThrow();
      const again = await acceptSource(
        database,
        { call: async () => [original, adjusted] },
        partition,
        new Date('2026-09-18T10:00:00Z'),
      );
      expect(again.accepted.changed).toBe(false);
      expect(await database.dividend.findFirstOrThrow()).toEqual(saved);
    }),
);

it('updates the same event for a newer base and never downgrades to an older or undated response', async () =>
  withSyncDatabase(async (database) => {
    await acceptSource(database, { call: async () => [original] }, partition);
    const first = await database.dividend.findFirstOrThrow();
    const nextCapture = new Date('2026-09-18T10:00:00Z');
    const updated = await acceptSource(
      database,
      { call: async () => [adjusted] },
      partition,
      nextCapture,
    );
    expect(updated.accepted).toMatchObject({ inserted: 0, updated: 1, rejected: 0 });
    const saved = await database.dividend.findFirstOrThrow();
    expect(saved).toMatchObject({
      id: first.id,
      baseDate: adjusted.base_date,
      cashDivTax: adjusted.cash_div_tax,
      observedAt: nextCapture,
    });

    for (const row of [original, { ...original, base_date: null }]) {
      const stale = await acceptSource(database, { call: async () => [row] }, partition);
      expect(stale.accepted.changed).toBe(false);
      expect(await database.dividend.findFirstOrThrow()).toEqual(saved);
    }
  }));

it('keeps implementation notices separate while filtering earlier stages', async () =>
  withSyncDatabase(async (database) => {
    const result = await acceptSource(
      database,
      {
        call: async () => [
          original,
          adjusted,
          { ...original, ann_date: '20190327' },
          { ...original, div_proc: '股东大会通过' },
        ],
      },
      partition,
    );
    expect(result.prepared.checks).toMatchObject({ sourceRows: 4, excludedRows: 2 });
    expect(result.accepted).toMatchObject({ inserted: 2, rejected: 0, errors: [] });
    expect(await database.dividend.count()).toBe(2);
  }));

it('preserves same-base conflicts, accepts independent events, and retains existing values', async () =>
  withSyncDatabase(async (database) => {
    await acceptSource(database, { call: async () => [adjusted] }, partition);
    const saved = await database.dividend.findFirstOrThrow();
    const conflict = { ...adjusted, cash_div_tax: 2 };
    const together = await acceptSource(
      database,
      {
        call: async () => [adjusted, conflict, { ...original, ann_date: '20190327' }],
      },
      partition,
    );
    expect(together.accepted).toMatchObject({ inserted: 1, rejected: 2, deleted: 0 });
    expect(await database.dividend.findUniqueOrThrow({ where: { id: saved.id } })).toEqual(saved);
    const acrossRuns = await acceptSource(database, { call: async () => [conflict] }, partition);
    expect(acrossRuns.accepted).toMatchObject({ changed: false, rejected: 1, deleted: 0 });
    expect(acrossRuns.accepted.errors.join(' ')).toContain('same base date');
    expect(await database.dividend.findUniqueOrThrow({ where: { id: saved.id } })).toEqual(saved);
  }));

it('fills legacy nullable bases without changing the event ID or guessing a base date', async () =>
  withSyncDatabase(async (database) => {
    const legacy = { ...original, base_date: null, base_share: null };
    await acceptSource(database, { call: async () => [legacy] }, partition);
    const saved = await database.dividend.findFirstOrThrow();
    expect(saved).toMatchObject({ baseDate: null, baseShare: null });
    await acceptSource(database, { call: async () => [adjusted] }, partition);
    expect(await database.dividend.findFirstOrThrow()).toMatchObject({
      id: saved.id,
      baseDate: adjusted.base_date,
      baseShare: adjusted.base_share,
      cashDivTax: adjusted.cash_div_tax,
    });
    expect(saved.observedAt).toEqual(capturedAt);
  }));

it('applies the generated additive migration without rewriting legacy dividends', async () =>
  withSyncDatabase(async (database) => {
    const before = await database.dividend.create({
      data: {
        id: 'legacy-dividend',
        tsCode: partition.scope,
        endDate: original.end_date,
        annDate: original.ann_date,
        divProc: original.div_proc,
        cashDivTax: original.cash_div_tax,
        observedAt: capturedAt,
        availabilityQuality: 'latest_only',
      },
    });
    await database.$executeRawUnsafe('ALTER TABLE "Dividend" DROP COLUMN "baseDate"');
    await database.$executeRawUnsafe('ALTER TABLE "Dividend" DROP COLUMN "baseShare"');
    const migration = await readFile(
      new URL(
        '../../../prisma/migrations/20261102040000_dividend_base_selection/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );

    for (const statement of migration.split(';')) {
      const sql = statement.replace(/^--.*$/gm, '').trim();
      if (sql) {
        await database.$executeRawUnsafe(sql);
      }
    }

    expect(await database.dividend.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before);
  }));
