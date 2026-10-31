import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { cleanData } from '#maintenance/clean.js';

const execute = promisify(execFile);
const apiDirectory = fileURLToPath(new URL('../../', import.meta.url));

describe('offline pending ETF cleanup', () => {
  it('protects references and removes unreferenced pending ETFs once', async () =>
    withSyncDatabase(async (database) => {
      const codes = Array.from({ length: 12 }, (_, index) => `${510000 + index}.SH`);
      await database.etfBasic.createMany({
        data: codes.map((tsCode, index) => ({
          tsCode,
          name: tsCode,
          listStatus: index < 10 ? 'P' : ['L', 'D'][index - 10],
          exchange: 'SH',
          sameDayTurnover: false,
          listDate: index === 9 ? '20260901' : null,
        })),
      });
      await database.etfDaily.create({
        data: { tsCode: codes[2], tradeDate: '20260911', close: 1 },
      });
      await database.etfAdjFactor.create({
        data: { tsCode: codes[3], tradeDate: '20260911', adjFactor: 1 },
      });
      await database.etfLatestSize.create({
        data: { tsCode: codes[4], tradeDate: '20260911', totalSize: 1 },
      });
      await database.etfSyncSlice.create({
        data: { tsCode: codes[5], startDate: '20260101', endDate: '20260911' },
      });
      await database.datasetSyncState.create({ data: { dataset: 'etf-prices', scope: codes[6] } });
      await database.datasetSyncPartition.create({
        data: {
          id: 'protected',
          dataset: 'etf-adjustments',
          scope: codes[7],
          startDate: '20260101',
          endDate: '20260911',
          status: 'pending',
        },
      });
      await database.marketDownloadList.create({ data: { assetType: 'etf', codes: [codes[8]] } });
      await database.marketDataState.create({ data: { key: 'global', revision: 7 } });

      const preview = await cleanData({ apply: false });
      expect(preview.items.map((row) => row.code)).toEqual(codes.slice(0, 2));
      expect(preview.retained.map((row) => row.code)).toEqual(codes.slice(2, 10));
      expect(await database.etfBasic.count()).toBe(12);
      expect(
        (await database.marketDataState.findUniqueOrThrow({ where: { key: 'global' } })).revision,
      ).toBe(7);

      expect(
        (
          await cleanData({
            apply: true,
            backup: async () => 'fixture-backup',
          })
        ).changed,
      ).toBe(2);
      expect(
        (
          await cleanData({
            apply: true,
            backup: async () => 'fixture-backup',
          })
        ).changed,
      ).toBe(0);
      expect(
        (await database.etfBasic.findMany({ orderBy: { tsCode: 'asc' } })).map((row) => row.tsCode),
      ).toEqual(codes.slice(2));
      expect(
        (await database.marketDataState.findUniqueOrThrow({ where: { key: 'global' } })).revision,
      ).toBe(8);
      expect(await database.etfDaily.count()).toBe(1);
      expect(await database.etfAdjFactor.count()).toBe(1);
      expect(
        (await database.marketDownloadList.findUniqueOrThrow({ where: { assetType: 'etf' } }))
          .codes,
      ).toEqual([codes[8]]);
    }));

  it('rolls back deletion when publication fails', async () =>
    withSyncDatabase(async (database) => {
      await database.etfBasic.create({
        data: {
          tsCode: '158025.OF',
          name: 'Fixture',
          listStatus: 'P',
          exchange: 'SZ',
          sameDayTurnover: false,
        },
      });
      await database.marketDataState.create({ data: { key: 'global', revision: 1 } });
      await database.$executeRawUnsafe(
        `CREATE TRIGGER reject_cleanup_revision BEFORE UPDATE ON MarketDataState
         BEGIN SELECT RAISE(ABORT, 'fixture publication failure'); END`,
      );

      await expect(
        cleanData({ apply: true, backup: async () => 'fixture-backup' }),
      ).rejects.toThrow();
      expect(await database.etfBasic.count()).toBe(1);
      expect(
        (await database.marketDataState.findUniqueOrThrow({ where: { key: 'global' } })).revision,
      ).toBe(1);
    }));

  it('backs up the explicit database through either CLI without a provider', async () =>
    withSyncDatabase(async (database, directory) => {
      await database.etfBasic.create({
        data: {
          tsCode: '158025.OF',
          name: 'Fixture',
          listStatus: 'P',
          exchange: 'SZ',
          sameDayTurnover: false,
        },
      });
      const entry =
        process.env.JIXIE_TEST_COMPILED === '1'
          ? ['dist/src/maintenance/cli/data.js']
          : ['--conditions=development', '--import', 'tsx', 'src/maintenance/cli/data.ts'];
      const options = {
        cwd: apiDirectory,
        env: {
          ...process.env,
          DATABASE_URL: 'invalid-default',
          TUSHARE_TOKEN: '',
          NODE_OPTIONS: '',
          JIXIE_BACKUP_DIR: join(directory, 'backup\'s "quoted" directory'),
        },
        timeout: 15_000,
      };
      const filename = join(directory, 'test.db');
      const checked = await execute(
        process.execPath,
        [...entry, 'clean', '--database', filename],
        options,
      );
      expect(JSON.parse(checked.stdout).items).toHaveLength(1);
      expect(await database.etfBasic.count()).toBe(1);
      const applied = await execute(
        process.execPath,
        [...entry, 'clean', '--database', filename, '--apply'],
        options,
      );
      expect(JSON.parse(applied.stdout)).toMatchObject({ changed: 1 });
      const snapshot = await execute('sqlite3', [
        '-readonly',
        JSON.parse(applied.stdout).backup,
        'SELECT count(*) FROM EtfBasic;',
      ]);
      expect(snapshot.stdout.trim()).toBe('1');
      expect(await database.etfBasic.count()).toBe(0);
      const repeated = await execute(
        process.execPath,
        [...entry, 'clean', '--database', filename, '--apply'],
        options,
      );
      expect(JSON.parse(repeated.stdout)).toMatchObject({ changed: 0, backup: null });
      await expect(
        execute(process.execPath, [...entry, 'clean', 'pending-etfs'], options),
      ).rejects.toMatchObject({
        code: 2,
      });
    }));
});
