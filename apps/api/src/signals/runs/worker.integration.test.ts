import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import { JobService } from '#jobs/job-service.js';
import { runWorker } from '#jobs/worker.js';
import {
  acquireMarketLock,
  acquireWorkOwner,
  MarketAccessBusyError,
} from '#infra/coordination/market-access.js';
import { signalWorkerMessageSchema } from './worker-protocol.js';

/**
 * 只替换用户计算，真实信号 Worker、IPC、数据库连接与监听端口均由真实子进程持有。
 *
 * Replace only user computation; the real signal worker child owns IPC, a database connection and a socket.
 */
async function controlledWorker(directory: string) {
  const computeUrl = pathToFileURL(join(directory, 'controlled-compute.mjs')).href;
  const loaderUrl = pathToFileURL(join(directory, 'controlled-loader.mjs')).href;
  const registration = join(directory, 'register-loader.mjs');
  const databaseUrl = new URL('../../infra/database/prisma.ts', import.meta.url).href;
  await writeFile(
    new URL(computeUrl),
    `
    import { createServer } from 'node:net';
    import { once } from 'node:events';
    import { getDatabase } from ${JSON.stringify(databaseUrl)};
    export async function runSignal(runId, log) {
      await getDatabase().$queryRawUnsafe('SELECT 1');
      const server = createServer();
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      log(JSON.stringify({ pid: process.pid, port: server.address().port }));
      await new Promise(() => {});
    }
  `,
  );
  await writeFile(
    new URL(loaderUrl),
    `
    export async function resolve(specifier, context, nextResolve) {
      if (specifier === './compute.js' && context.parentURL.includes('/signals/runs/worker.ts')) {
        return { url: ${JSON.stringify(computeUrl)}, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    }
  `,
  );
  await writeFile(
    registration,
    `import { register } from 'node:module'; register(${JSON.stringify(loaderUrl)});`,
  );

  return () =>
    fork(new URL('./worker.ts', import.meta.url), ['controlled-run'], {
      execArgv: ['--conditions=development', '--import', 'tsx', '--import', registration],
      env: { ...process.env },
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
}

async function assertReleased(child: ChildProcess, port: number) {
  expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  expect(() => process.kill(child.pid!, 0)).toThrow();
  const server = createServer();
  try {
    server.listen(port, '127.0.0.1');
    await once(server, 'listening');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

it(
  'A11/A13 cancels the real signal child before releasing its Job owner and market reader',
  async () =>
    withSyncDatabase(async (database, directory) => {
      const start = await controlledWorker(directory);
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]);
      let child!: ChildProcess;
      let ready!: (value: { pid: number; port: number }) => void;
      const readiness = new Promise<{ pid: number; port: number }>((resolve) => {
        ready = resolve;
      });
      JobService.register('research-curator', {
        onExecute: async (_job, log, signal) =>
          runWorker({
            start: () => {
              child = start();
              return child;
            },
            signal,
            onLog: (entry) => {
              log(entry);
              ready(JSON.parse(entry.text));
            },
            readMessage: (raw) => {
              const message = signalWorkerMessageSchema.parse(raw);
              return message.type === 'done' ? { type: 'done', payload: message.output } : message;
            },
            exitedMessage: (code) => `Controlled signal worker exited ${code}`,
          }),
      });
      await database.user.create({ data: { id: 'owner', email: 'fixture@example.invalid' } });
      const jobId = await JobService.create('owner', 'research-curator', 'controlled-worker', {});
      expect(await JobService.claim(jobId)).toBe(true);
      const execution = JobService.execute(jobId, signal);
      try {
        const fixture = await Promise.race([
          readiness,
          execution.then(() => {
            throw new Error('Worker exited before readiness');
          }),
        ]);
        expect(fixture.pid).toBe(child.pid);
        await expect(acquireWorkOwner('job', jobId)).rejects.toBeInstanceOf(MarketAccessBusyError);
        await expect(acquireMarketLock('market-access')).rejects.toBeInstanceOf(
          MarketAccessBusyError,
        );
        controller.abort(new Error('Controlled cancellation'));
        await execution;
        expect(child.signalCode).toBe('SIGKILL');
        await assertReleased(child, fixture.port);
        const owner = await acquireWorkOwner('job', jobId);
        await owner.release();
        const publication = await acquireMarketLock('market-access');
        await publication.release();
        expect(await database.job.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({
          status: 'stale',
        });
        expect(await database.user.count()).toBe(1);
      } finally {
        controller.abort();
        await execution;
      }
    }),
  30_000,
);

it(
  'A13 exits the real signal worker on parent IPC disconnect and releases its socket and SQLite connection',
  async () =>
    withSyncDatabase(async (database, directory) => {
      const start = await controlledWorker(directory);
      let child!: ChildProcess;
      let ready!: (value: { pid: number; port: number }) => void;
      const readiness = new Promise<{ pid: number; port: number }>((resolve) => {
        ready = resolve;
      });
      const result = runWorker({
        start: () => {
          child = start();
          return child;
        },
        signal: AbortSignal.timeout(10_000),
        onLog: (entry) => ready(JSON.parse(entry.text)),
        readMessage: (raw) => {
          const message = signalWorkerMessageSchema.parse(raw);
          return message.type === 'done' ? { type: 'done', payload: message.output } : message;
        },
        exitedMessage: (code) => `Controlled signal worker exited ${code}`,
      }).then(
        () => null,
        (error: unknown) => error,
      );
      try {
        const fixture = await Promise.race([
          readiness,
          result.then((error) => {
            throw error;
          }),
        ]);
        child.disconnect();
        expect(await result).toBeInstanceOf(Error);
        expect(child.exitCode).toBe(1);
        await assertReleased(child, fixture.port);
        expect(await database.user.count()).toBe(0);
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          const exited = once(child, 'exit');
          child.kill('SIGKILL');
          await exited;
        }
        await result;
      }
    }),
  30_000,
);
