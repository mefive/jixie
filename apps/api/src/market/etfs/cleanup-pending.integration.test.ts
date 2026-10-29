import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import { cleanupPendingEtfs } from './cleanup-pending.js';

const execute = promisify(execFile);
const apiDirectory = fileURLToPath(new URL('../../../', import.meta.url));

describe('offline pending ETF cleanup', () => {
  it('protects every business reference and changes only unreferenced pending metadata once', async () =>
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
          policyVersion: 'sync-v1',
        },
      });
      await database.marketDownloadList.create({ data: { assetType: 'etf', codes: [codes[8]] } });
      await database.marketDataState.create({ data: { key: 'global', revision: 7 } });

      const preview = await cleanupPendingEtfs(false);
      expect(preview.removableCodes).toEqual(codes.slice(0, 2));
      expect(preview.protectedRows.map((row) => row.tsCode)).toEqual(codes.slice(2, 10));
      expect(await database.etfBasic.count()).toBe(12);
      expect(
        (await database.marketDataState.findUniqueOrThrow({ where: { key: 'global' } })).revision,
      ).toBe(7);

      expect((await cleanupPendingEtfs(true)).deleted).toBe(2);
      expect((await cleanupPendingEtfs(true)).deleted).toBe(0);
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
        "CREATE TRIGGER reject_cleanup_revision BEFORE UPDATE ON MarketDataState BEGIN SELECT RAISE(ABORT, 'fixture publication failure'); END",
      );

      await expect(cleanupPendingEtfs(true)).rejects.toThrow();
      expect(await database.etfBasic.count()).toBe(1);
      expect(
        (await database.marketDataState.findUniqueOrThrow({ where: { key: 'global' } })).revision,
      ).toBe(1);
    }));

  it('executes the source or compiled CLI against only the explicit database without provider configuration', async () =>
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
          ? ['dist/src/market/cli/cleanup-pending-etfs.js']
          : [
              '--conditions=development',
              '--import',
              'tsx',
              'src/market/cli/cleanup-pending-etfs.ts',
            ];
      const options = {
        cwd: apiDirectory,
        env: {
          ...process.env,
          DATABASE_URL: 'invalid-default',
          TUSHARE_TOKEN: '',
          NODE_OPTIONS: '',
        },
        timeout: 15_000,
      };
      const filename = join(directory, 'test.db');
      const checked = await execute(process.execPath, [...entry, 'check', filename], options);
      expect(checked.stdout.trim()).toBe('1');
      expect(await database.etfBasic.count()).toBe(1);
      const applied = await execute(process.execPath, [...entry, 'apply', filename], options);
      expect(JSON.parse(applied.stdout)).toMatchObject({ deleted: 1 });
      expect(await database.etfBasic.count()).toBe(0);
      expect(
        (await execute(process.execPath, [...entry, 'check', filename], options)).stdout.trim(),
      ).toBe('0');
      await expect(execute(process.execPath, [...entry, 'apply'], options)).rejects.toMatchObject({
        code: 2,
      });
    }));
});
