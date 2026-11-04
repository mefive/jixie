import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { withSyncDatabase } from '../../../tests/sync-database.js';

async function listRuns(directory: string, arguments_: string[] = []) {
  const result = await promisify(execFile)(
    process.execPath,
    [
      '--conditions=development',
      '--import',
      'tsx',
      'src/ingestion/cli/data.ts',
      'runs',
      ...arguments_,
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

  return JSON.parse(result.stdout) as Array<Record<string, unknown>>;
}

it(
  'lists only four fields, defaults to five rows and deterministically selects the newest run',
  async () =>
    withSyncDatabase(async (database, directory) => {
      const base = new Date('2026-11-01T00:00:00Z').getTime();
      for (let index = 0; index < 7; index++) {
        const startedAt = new Date(base + Math.min(index, 5) * 60_000);
        await database.ingestionRun.create({
          data: {
            id: `RUN${index}`,
            trigger: 'manual',
            targetDate: '20181231',
            status: index === 6 ? 'running' : 'completed',
            startedAt,
            finishedAt: index === 6 ? null : new Date(startedAt.getTime() + 10_000),
            scopeSnapshot: { privatePlanSentinel: 'large-plan'.repeat(1000) },
            summary: { privateSummarySentinel: 'summary details' },
          },
        });
      }
      const before = await database.ingestionRun.findMany({ orderBy: { id: 'asc' } });
      const runs = await listRuns(directory);
      expect(runs.map((run) => run.id)).toEqual(['RUN6', 'RUN5', 'RUN4', 'RUN3', 'RUN2']);
      for (const run of runs) {
        expect(Object.keys(run).sort()).toEqual(['finishedAt', 'id', 'startedAt', 'status']);
      }
      expect(runs[0]).toEqual({
        id: 'RUN6',
        status: 'running',
        startedAt: new Date(base + 5 * 60_000).toISOString(),
        finishedAt: null,
      });
      const latest = await listRuns(directory, ['--limit', '1']);
      expect(latest).toEqual([runs[0]]);
      const all = await listRuns(directory, ['--limit', '100']);
      expect(all).toHaveLength(7);
      expect(JSON.stringify(all)).not.toMatch(
        /privatePlanSentinel|privateSummarySentinel|targetDate|trigger/,
      );
      expect(await database.ingestionRun.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
    }),
  60_000,
);

it(
  'returns an empty array when there are no runs',
  async () =>
    withSyncDatabase(async (_database, directory) => {
      expect(await listRuns(directory, ['--limit', '1'])).toEqual([]);
    }),
  60_000,
);
