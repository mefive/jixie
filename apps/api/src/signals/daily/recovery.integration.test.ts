import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import { acquireWorkOwner } from '#infra/coordination/market-access.js';
import type { Prisma } from '#infra/database/prisma.js';
import { getDatabase } from '#infra/database/prisma.js';
import { signalWorkerOutputSchema } from '../runs/worker-protocol.js';
import { generateDailySignals } from './scheduler.js';

const execution = vi.hoisted(() => ({ worker: vi.fn(), email: vi.fn() }));
vi.mock('#jobs/worker.js', () => ({ runWorker: execution.worker }));
vi.mock('#infra/email/email.js', () => ({
  isEmailConfigured: () => true,
  sendEmail: execution.email,
}));
vi.mock('#signals/accounting/initialize.js', () => ({ initializeSignalAccounting: vi.fn() }));
vi.mock('../accounting/settlement.js', () => ({
  settleStrategyAccounts: async () => ({
    deployments: 0,
    done: 0,
    waiting: 0,
    errors: 0,
    gaps: [],
    failures: [],
  }),
}));
vi.mock('#strategy/sandbox/inspect-definition.js', () => ({
  inspectStrategyMetadata: async () => ({ watch: [] }),
}));

const tradeDate = '20260915';
const emptyAccounts = { deployments: 0, done: 0, waiting: 0, errors: 0, gaps: [], failures: [] };

async function seed(database: Prisma) {
  const config = {
    name: 'Fixture',
    start: '20260914',
    end: tradeDate,
    initialCash: 100000,
    code: 'fixture',
  };
  await database.user.create({ data: { id: 'owner', email: 'fixture@example.invalid' } });
  await database.strategy.create({
    data: { id: 'strategy', userId: 'owner', name: 'Fixture', config },
  });
  await database.strategyDeployment.create({
    data: {
      id: 'deployment',
      userId: 'owner',
      strategyId: 'strategy',
      strategyName: 'Fixture',
      codeHash: 'fixture',
      config,
      status: 'active',
      locale: 'en',
    },
  });
  await database.tradeCal.createMany({
    data: ['20260914', tradeDate, '20260916'].map((calDate) => ({
      exchange: 'SSE',
      calDate,
      isOpen: 1,
    })),
  });
  await database.datasetSyncPartition.createMany({
    data: ['calendar', 'stock-prices', 'stock-adjustments', 'stock-valuations', 'stock-limits'].map(
      (dataset) => ({
        id: dataset,
        dataset,
        scope: dataset === 'calendar' ? 'SSE' : 'all',
        startDate: '20260914',
        endDate: '20260916',
        status: 'complete',
        policyVersion: 'sync-v1',
      }),
    ),
  });
  await database.signalRun.create({
    data: {
      id: 'interrupted-run',
      userId: 'owner',
      strategyId: 'strategy',
      deploymentId: 'deployment',
      tradeDate,
      execDate: '20260916',
    },
  });
  await database.job.create({
    data: {
      id: 'orphan',
      userId: 'owner',
      kind: 'signal',
      key: 'interrupted-run',
      signalRunId: 'interrupted-run',
      status: 'running',
      payload: { task: 'signal', runId: 'interrupted-run', locale: 'en' },
    },
  });
}

describe('bounded signal recovery during synchronization', () => {
  beforeEach(() => {
    execution.email.mockReset().mockResolvedValue(undefined);
    execution.worker.mockReset().mockResolvedValue(
      signalWorkerOutputSchema.parse({
        dataCutoff: tradeDate,
        modelEquity: 100000,
        modelCash: 100000,
        modelPositions: [],
        signals: [],
        factorInputs: [],
      }),
    );
  });

  it(
    'R04/A11/A13 recovers a killed owner with the host still alive and never repeats completed work or notifications',
    async () =>
      withSyncDatabase(async (database) => {
        await seed(database);
        const modulePath = fileURLToPath(
          new URL('../../infra/coordination/market-access.ts', import.meta.url),
        );
        const script = `
      import { acquireWorkOwner } from ${JSON.stringify(modulePath)};
      const owner = await acquireWorkOwner('job', 'orphan');
      process.send({ owned: true });
      setInterval(() => {}, 1000);
    `;
        const child = spawn(
          process.execPath,
          ['--conditions=development', '--import', 'tsx', '--input-type=module', '--eval', script],
          { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { ...process.env } },
        );
        try {
          await once(child, 'message', { signal: AbortSignal.timeout(10_000) });
          const exited = once(child, 'exit');
          child.kill('SIGKILL');
          await exited;
          expect(getDatabase()).toBe(database);
          await expect(
            generateDailySignals(tradeDate, () => {}, AbortSignal.timeout(5000)),
          ).resolves.toEqual({
            deployments: 1,
            done: 1,
            waiting: 0,
            errors: 0,
            accounts: emptyAccounts,
          });
          expect(await database.job.findUniqueOrThrow({ where: { id: 'orphan' } })).toMatchObject({
            status: 'stale',
          });
          expect(
            await database.job.count({ where: { signalRunId: 'interrupted-run', status: 'done' } }),
          ).toBe(1);
          expect(execution.worker).toHaveBeenCalledTimes(1);
          expect(execution.email).toHaveBeenCalledTimes(1);
          const frozen = await database.signalRun.findUniqueOrThrow({
            where: { id: 'interrupted-run' },
          });
          await expect(
            generateDailySignals(tradeDate, () => {}, AbortSignal.timeout(5000)),
          ).resolves.toMatchObject({ done: 1, waiting: 0, errors: 0 });
          expect(execution.worker).toHaveBeenCalledTimes(1);
          expect(execution.email).toHaveBeenCalledTimes(1);
          expect(await database.signalRun.findUniqueOrThrow({ where: { id: frozen.id } })).toEqual(
            frozen,
          );
        } finally {
          if (child.exitCode === null && child.signalCode === null) {
            const exited = once(child, 'exit');
            child.kill('SIGKILL');
            await exited;
          }
        }
      }),
    30_000,
  );

  it(
    'R04/A07 protects another active owner and bounds the observer by cancellation',
    async () =>
      withSyncDatabase(async (database) => {
        await seed(database);
        const owner = await acquireWorkOwner('job', 'orphan');
        try {
          const started = Date.now();
          await expect(
            generateDailySignals(tradeDate, () => {}, AbortSignal.timeout(1000)),
          ).resolves.toEqual({
            deployments: 1,
            done: 0,
            waiting: 1,
            errors: 0,
            accounts: emptyAccounts,
          });
          expect(Date.now() - started).toBeLessThan(5000);
          expect(await database.job.findUniqueOrThrow({ where: { id: 'orphan' } })).toMatchObject({
            status: 'running',
          });
          expect(await database.job.count()).toBe(1);
          expect(execution.worker).not.toHaveBeenCalled();
          expect(execution.email).not.toHaveBeenCalled();
        } finally {
          await owner.release();
        }
      }),
    15_000,
  );

  it(
    'R04/A13 passes cancellation to a claimed worker and leaves a retryable attempt without notification',
    async () =>
      withSyncDatabase(async (database) => {
        await seed(database);
        execution.worker.mockImplementationOnce(
          (options: { signal: AbortSignal }) =>
            new Promise((_resolve, reject) => {
              options.signal.addEventListener('abort', () => reject(options.signal.reason), {
                once: true,
              });
            }),
        );
        await expect(
          generateDailySignals(tradeDate, () => {}, AbortSignal.timeout(1000)),
        ).resolves.toEqual({
          deployments: 1,
          done: 0,
          waiting: 1,
          errors: 0,
          accounts: emptyAccounts,
        });
        expect(await database.job.count({ where: { status: 'stale' } })).toBe(2);
        expect(execution.email).not.toHaveBeenCalled();
        await expect(
          generateDailySignals(tradeDate, () => {}, AbortSignal.timeout(5000)),
        ).resolves.toMatchObject({ done: 1 });
        expect(execution.email).toHaveBeenCalledTimes(1);
      }),
    15_000,
  );
});
