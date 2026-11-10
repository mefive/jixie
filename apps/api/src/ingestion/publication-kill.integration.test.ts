import { expect, it } from 'vitest';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { readdir } from 'node:fs/promises';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { emptySelections, ingestionSource, ingestionTime } from '../../tests/ingestion-source.js';
import { ingestCandidate, inspectCandidate, acceptCandidate, recoverCandidate } from './replica.js';
import { candidateFilename } from './replica-files.js';

it(
  'recovers after SIGKILL during real publication writes without exposing a partial commit',
  async () =>
    withSyncDatabase(async (main) => {
      await emptySelections(main);
      const staged = await ingestCandidate(
        {
          targetDate: '19910104',
          source: ingestionSource(),
          clock: () => ingestionTime,
          onLog: () => {},
        },
        true,
      );
      const review = await inspectCandidate(staged.runId);
      const child = fork(
        fileURLToPath(new URL('./publication-kill.fixture.ts', import.meta.url)),
        [staged.runId, review.candidateVersion!],
        {
          execArgv: ['--conditions=development', '--import', 'tsx'],
          env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
          stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        },
      );
      let diagnostic = '';
      child.stderr?.on('data', (chunk) => {
        diagnostic = (diagnostic + String(chunk)).slice(-16000);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`Child did not reach transaction write: ${diagnostic}`)),
            20000,
          );
          child.once('message', (message) => {
            clearTimeout(timer);
            if (message === 'transaction-wrote-first-chunk') {
              resolve();
            } else {
              reject(new Error('Unexpected child message'));
            }
          });
          child.once('error', (error) => {
            clearTimeout(timer);
            reject(error);
          });
          child.once('exit', () => {
            clearTimeout(timer);
            reject(new Error(`Child exited before pause: ${diagnostic}`));
          });
        });
        const stopped = once(child, 'exit');
        child.kill('SIGKILL');
        await stopped;

        expect(await main.tradeCal.count()).toBe(0);
        expect(await main.daily.count()).toBe(0);
        expect(await main.marketDataState.count()).toBe(0);
        expect(
          await main.ingestionRun.findUniqueOrThrow({ where: { id: staged.runId } }),
        ).toMatchObject({ replicaPhase: 'publishing', publishedAt: null });
        const directory = dirname(candidateFilename(staged.runId));
        expect((await readdir(directory)).some((name) => name.endsWith('.plan'))).toBe(true);
        await expect(recoverCandidate(staged.runId)).resolves.toMatchObject({
          phase: 'awaiting_publish',
        });
        expect((await readdir(directory)).some((name) => name.endsWith('.plan'))).toBe(false);
        await expect(
          acceptCandidate(staged.runId, review.candidateVersion!),
        ).resolves.toMatchObject({ mode: 'published' });
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          const stopped = once(child, 'exit');
          child.kill('SIGKILL');
          await stopped;
        }
      }
    }),
  60000,
);
