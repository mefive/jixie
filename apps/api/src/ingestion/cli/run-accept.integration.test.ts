import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  emptySelections,
  ingestionSource,
  ingestionTime,
} from '../../../tests/ingestion-source.js';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import { ingestCandidate, inspectCandidate } from '../replica.js';

const targetDate = '19910104';
const input = {
  targetDate,
  source: ingestionSource(),
  clock: () => ingestionTime,
  onLog: () => {},
};

async function acceptRun(directory: string, runId: string, options: string[] = []) {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      '--conditions=development',
      '--import',
      'tsx',
      'src/ingestion/cli/data.ts',
      'runs',
      'accept',
      runId,
      ...options,
    ],
    {
      cwd: new URL('../../../', import.meta.url),
      env: {
        ...process.env,
        DATABASE_URL: `file:${join(directory, 'test.db')}`,
        TUSHARE_TOKEN: '',
      },
      timeout: 30_000,
    },
  );

  return JSON.parse(stdout) as Record<string, unknown>;
}

it(
  'publishes the current candidate without a hash and keeps repeated acceptance idempotent',
  async () =>
    withSyncDatabase(async (main, directory) => {
      await emptySelections(main);
      const staged = await ingestCandidate(input, true);
      expect(staged.phase).toBe('awaiting_publish');

      await expect(acceptRun(directory, staged.runId)).resolves.toMatchObject({
        mode: 'published',
        runId: staged.runId,
      });
      expect(await main.daily.count()).toBeGreaterThan(0);
      expect(
        await main.ingestionRun.findUniqueOrThrow({ where: { id: staged.runId } }),
      ).toMatchObject({
        activeReplica: null,
        replicaPhase: 'published',
      });

      await expect(acceptRun(directory, staged.runId)).resolves.toMatchObject({
        mode: 'already_published',
        runId: staged.runId,
      });
    }),
  60_000,
);

it(
  'continues to reject an explicitly mismatched hash without publishing any data',
  async () =>
    withSyncDatabase(async (main, directory) => {
      await emptySelections(main);
      const staged = await ingestCandidate(input, true);

      await expect(
        acceptRun(directory, staged.runId, ['--expect-candidate', 'a'.repeat(64)]),
      ).rejects.toMatchObject({ code: 1 });
      expect(await main.daily.count()).toBe(0);
      expect(await inspectCandidate(staged.runId)).toMatchObject({
        phase: 'awaiting_publish',
        pending: 0,
      });
    }),
  60_000,
);

it(
  'rechecks unresolved candidate issues even when the stored phase claims it is ready',
  async () =>
    withSyncDatabase(async (main, directory) => {
      await emptySelections(main);
      const staged = await ingestCandidate(
        {
          ...input,
          source: ingestionSource({
            prices: (date) => [
              {
                ts_code: '600000.SH',
                trade_date: date,
                open: 10,
                high: 12,
                low: date === targetDate ? 11 : 9,
                close: 11,
              },
            ],
          }),
        },
        true,
      );
      expect(staged.phase).toBe('awaiting_repair');

      await expect(acceptRun(directory, staged.runId)).rejects.toMatchObject({ code: 1 });

      // 模拟主库阶段尚未反映副本未处理问题，验证接收不只信任阶段字段。
      // Simulate stale main phase metadata to verify acceptance rechecks candidate issues.
      await main.ingestionRun.update({
        where: { id: staged.runId },
        data: { replicaPhase: 'awaiting_publish' },
      });

      await expect(acceptRun(directory, staged.runId)).rejects.toMatchObject({ code: 1 });
      expect(await main.daily.count()).toBe(0);
      expect((await inspectCandidate(staged.runId)).pending).toBeGreaterThan(0);
    }),
  60_000,
);

it(
  'rejects acceptance while the run is still collecting',
  async () =>
    withSyncDatabase(async (main, directory) => {
      const runId = '01M6F8ZGFR17X3ZMAX5Z7GD1DY';
      await main.ingestionRun.create({
        data: {
          id: runId,
          targetDate,
          trigger: 'manual',
          scopeSnapshot: {},
          status: 'running',
          activeReplica: 1,
          replicaPhase: 'running',
        },
      });

      await expect(acceptRun(directory, runId)).rejects.toMatchObject({ code: 1 });
      expect(await main.ingestionRun.findUniqueOrThrow({ where: { id: runId } })).toMatchObject({
        replicaPhase: 'running',
        publishedAt: null,
      });
    }),
  60_000,
);
