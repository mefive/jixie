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
import { acceptCandidate, ingestCandidate, inspectCandidate } from '../replica.js';
import { candidateFilename, createCandidateFile, withCandidate } from '../replica-files.js';

async function inspectRun(directory: string, runId: string) {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      '--conditions=development',
      '--import',
      'tsx',
      'src/ingestion/cli/data.ts',
      'runs',
      'inspect',
      runId,
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

  return JSON.parse(stdout) as { batches: unknown[] };
}

it(
  'inspects both attempts of a batch before and after candidate publication',
  async () =>
    withSyncDatabase(async (main, directory) => {
      await emptySelections(main);
      const { runId } = await ingestCandidate(
        {
          targetDate: '19910104',
          source: ingestionSource(),
          clock: () => ingestionTime,
          onLog: () => {},
        },
        true,
      );
      const succeeded = await withCandidate(runId, async (candidate) => {
        const batch = await candidate.ingestionBatch.findFirstOrThrow({
          where: { runId, status: 'succeeded' },
          orderBy: { id: 'asc' },
        });
        await candidate.ingestionBatch.create({
          data: {
            id: 'earlier-attempt',
            runId,
            dataset: batch.dataset,
            scope: batch.scope,
            period: batch.period,
            api: batch.api,
            rangeStart: batch.rangeStart,
            rangeEnd: batch.rangeEnd,
            request: { privateRequest: 'omitted' },
            status: 'failed',
            startedAt: new Date(batch.startedAt.getTime() - 1000),
            finishedAt: new Date(batch.startedAt.getTime() - 250),
          },
        });

        return batch;
      });
      const review = await inspectCandidate(runId);
      const { candidateVersion } = review;
      expect(review).not.toHaveProperty('batches');
      expect(await main.ingestionBatch.count({ where: { runId } })).toBe(0);

      const candidate = await inspectRun(directory, runId);
      expect(candidate).toMatchObject({
        runId,
        phase: 'awaiting_publish',
        candidateVersion,
        startedAt: ingestionTime.toISOString(),
        finishedAt: ingestionTime.toISOString(),
      });
      expect(candidate.batches[0]).toEqual({
        id: 'earlier-attempt',
        dataset: succeeded.dataset,
        scope: succeeded.scope,
        period: succeeded.period,
        api: succeeded.api,
        rangeStart: succeeded.rangeStart,
        rangeEnd: succeeded.rangeEnd,
        status: 'failed',
        startedAt: new Date(ingestionTime.getTime() - 1000).toISOString(),
        finishedAt: new Date(ingestionTime.getTime() - 250).toISOString(),
        elapsedMs: 750,
      });
      expect(candidate.batches).toContainEqual(
        expect.objectContaining({ id: succeeded.id, status: 'succeeded', elapsedMs: 0 }),
      );

      if (!candidateVersion) {
        throw new Error('Expected a reviewable candidate version');
      }
      await acceptCandidate(runId, candidateVersion);
      const published = await inspectRun(directory, runId);
      expect(published).toMatchObject({
        phase: 'published',
        startedAt: ingestionTime.toISOString(),
        finishedAt: ingestionTime.toISOString(),
      });
      expect(published.batches).toEqual(candidate.batches);
    }),
  60_000,
);

it(
  'returns unfinished timings after the running replica becomes available',
  async () =>
    withSyncDatabase(async (main, directory) => {
      const runId = '01M6F8ZGFR17X3ZMAX5Z7GD1DY';
      await main.ingestionRun.create({
        data: {
          id: runId,
          targetDate: '19910104',
          trigger: 'manual',
          scopeSnapshot: {},
          startedAt: ingestionTime,
          status: 'running',
          activeReplica: 1,
          replicaPhase: 'running',
        },
      });

      expect(await inspectRun(directory, runId)).toMatchObject({
        phase: 'running',
        startedAt: ingestionTime.toISOString(),
        finishedAt: null,
        batches: [],
      });

      await createCandidateFile(candidateFilename(runId));
      await withCandidate(runId, (candidate) =>
        candidate.ingestionBatch.create({
          data: {
            id: 'in-flight-attempt',
            runId,
            dataset: 'calendar',
            scope: 'SSE',
            period: '1991',
            api: 'trade_cal',
            request: {},
            status: 'running',
            startedAt: ingestionTime,
          },
        }),
      );
      await main.ingestionRun.update({
        where: { id: runId },
        data: { replicaReadyAt: ingestionTime },
      });

      expect(await inspectRun(directory, runId)).toMatchObject({
        phase: 'running',
        finishedAt: null,
        batches: [
          {
            id: 'in-flight-attempt',
            status: 'running',
            startedAt: ingestionTime.toISOString(),
            finishedAt: null,
            elapsedMs: null,
          },
        ],
      });
    }),
  60_000,
);
