import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import { acceptSource, capturedAt } from '../../../tests/market-contract-fixtures.js';
import { YONGTAI_DIVIDENDS } from './fixtures/yongtai-dividends.js';
import { DIVIDEND_SOURCE_COLUMNS } from './dividend-identity.js';
import { withImportDiagnostics, type ImportDiagnostics } from '../synchronization/diagnostics.js';

const partition = { dataset: 'dividends', scope: '002326.SZ', startDate: '', endDate: '20181231' };

it.each([false, true])(
  'retains both Yongtai distributions and both cash notices, reversed=%s',
  async (reversed) =>
    withSyncDatabase(async (database) => {
      const source = [...YONGTAI_DIVIDENDS];
      if (reversed) {
        source.reverse();
      }
      const diagnostics: ImportDiagnostics = { requests: [], issues: [] };
      const result = await withImportDiagnostics(diagnostics, () =>
        acceptSource(database, { call: async () => source }, partition),
      );
      expect(result.accepted).toMatchObject({ inserted: 7, rejected: 0, errors: [] });
      expect(diagnostics.issues).toEqual([]);
      const proposals = await database.dividend.findMany({ where: { divProc: '预案' } });
      expect(proposals).toHaveLength(2);
      expect(proposals.find((row) => row.distributionKind === 'shares')).toMatchObject({
        stockDividend: 0.12,
        stockCapitalizationRate: 0.12,
        cashDivTax: 0,
        baseShare: 51277.8827,
      });
      expect(proposals.find((row) => row.distributionKind === 'cash')).toMatchObject({
        stockDividend: 0,
        cashDivTax: 0.15,
        baseShare: 82009.3827,
      });
      expect(await database.dividend.count({ where: { divProc: '实施' } })).toBe(2);
      const again = await acceptSource(
        database,
        { call: async () => source },
        partition,
        new Date('2026-10-01T10:00:00Z'),
      );
      expect(again.accepted).toMatchObject({ changed: false, rejected: 0 });
    }),
);

it('backfills old fields without replacing source IDs, capture dates or independent distributions', async () =>
  withSyncDatabase(async (database) => {
    await database.dividend.create({
      data: {
        id: 'old-cash',
        tsCode: partition.scope,
        sourceTsCode: partition.scope,
        endDate: '20181231',
        annDate: '20190720',
        divProc: '预案',
        cashDiv: 0,
        cashDivTax: 0.15,
        baseDate: '20181231',
        baseShare: 82009.3827,
        observedAt: capturedAt,
        availabilityQuality: 'latest_only',
      },
    });
    const result = await acceptSource(
      database,
      { call: async () => YONGTAI_DIVIDENDS },
      partition,
      new Date('2026-10-01T10:00:00Z'),
    );
    expect(result.accepted).toMatchObject({ inserted: 6, updated: 1, rejected: 0 });
    expect(await database.dividend.findUniqueOrThrow({ where: { id: 'old-cash' } })).toMatchObject({
      distributionKind: 'cash',
      stockDividend: 0,
      observedAt: capturedAt,
    });
  }));

it('keeps same-shape true conflicts, including stock amounts, and accepts mixed plans', async () =>
  withSyncDatabase(async (database) => {
    const mixed = { ...YONGTAI_DIVIDENDS[0], stk_div: 0.12, stk_co_rate: 0.12 };
    await acceptSource(database, { call: async () => [mixed] }, partition);
    const before = await database.dividend.findFirstOrThrow();
    const result = await acceptSource(
      database,
      { call: async () => [{ ...mixed, stk_div: 0.13 }] },
      partition,
    );
    expect(result.accepted).toMatchObject({ rejected: 1, changed: false });
    expect(await database.dividend.findFirstOrThrow()).toEqual(before);
    expect(before).toMatchObject({
      distributionKind: 'mixed',
      stockDividend: 0.12,
      stockCapitalizationRate: 0.12,
    });
  }));

it('does not guess legacy distribution identity or delete records when the legacy match is ambiguous', async () =>
  withSyncDatabase(async (database) => {
    await database.dividend.create({
      data: {
        id: 'unknown',
        tsCode: partition.scope,
        endDate: '20181231',
        annDate: '20190720',
        divProc: '预案',
        observedAt: capturedAt,
      },
    });
    const result = await acceptSource(
      database,
      { call: async () => YONGTAI_DIVIDENDS.slice(0, 2) },
      partition,
    );
    expect(result.prepared.errors.join(' ')).toContain('Ambiguous legacy');
    expect(result.accepted.deleted).toBe(0);
    expect(await database.dividend.findUnique({ where: { id: 'unknown' } })).not.toBeNull();
  }));

it('rejects invalid non-null source dates and share ratios with the original payload retained', async () =>
  withSyncDatabase(async (database) => {
    const diagnostics: ImportDiagnostics = { requests: [], issues: [] };
    const invalid = { ...YONGTAI_DIVIDENDS[0], record_date: 'bad' };
    const negative = { ...YONGTAI_DIVIDENDS[1], stk_div: -1 };
    await withImportDiagnostics(diagnostics, () =>
      acceptSource(database, { call: async () => [invalid, negative] }, partition),
    );
    expect(await database.dividend.count()).toBe(0);
    expect(diagnostics.issues.map((issue) => issue.payload)).toEqual([invalid, negative]);
  }));

it('applies the generated additive migration while preserving old amounts, IDs and capture times', async () =>
  withSyncDatabase(async (database) => {
    const before = await database.dividend.create({
      data: {
        id: 'legacy',
        tsCode: partition.scope,
        endDate: '20181231',
        cashDivTax: 0.15,
        baseShare: 82009.3827,
        observedAt: capturedAt,
      },
    });
    const added = ['distributionKind', ...Object.keys(DIVIDEND_SOURCE_COLUMNS).slice(9)];
    for (const field of added) {
      await database.$executeRawUnsafe(`ALTER TABLE "Dividend" DROP COLUMN "${field}"`);
    }
    const migration = await readFile(
      new URL(
        '../../../prisma/migrations/20261103104046_dividend_distribution_identity/migration.sql',
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
    expect(await database.dividend.findUniqueOrThrow({ where: { id: 'legacy' } })).toEqual(before);
  }));
