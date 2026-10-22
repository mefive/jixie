import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { withMarketAccess, MarketAccessBusyError } from '#infra/coordination/market-access.js';

const fixture = vi.hoisted(() => ({
  prepareFailure: false,
  prepared: undefined as (() => Promise<void>) | undefined,
  weather: vi.fn(),
}));
vi.mock('#signals/daily/scheduler.js', () => ({
  generateDailySignals: vi.fn(async () => ({ deployments: 0, done: 0, errors: 0 })),
}));
vi.mock('#factor/weather/refresh.js', () => ({ refreshAllFactorWeatherPins: fixture.weather }));
vi.mock('../workflows/execute.js', () => ({
  executeMaintenanceWorkflow: vi.fn(async () => {
    const { getDatabase } = await import('#infra/database/prisma.js');
    const { MarketSourceDownloadError } = await import('#market/errors.js');
    await getDatabase().tradeCal.updateMany({ data: { isOpen: 1 } });
    await fixture.prepared?.();
    if (fixture.prepareFailure) {
      throw new MarketSourceDownloadError('Injected source failure');
    }
  }),
}));
vi.mock('./finalize.js', () => ({ finalizeCandidate: vi.fn(async () => {}) }));

let directory: string;
let prisma: (typeof import('#infra/database/prisma.js'))['prisma'];
let runStagedMaintenance: (typeof import('./coordinator.js'))['runStagedMaintenance'];
let getMaintenanceStatus: (typeof import('../runs/state.js'))['getMaintenanceStatus'];
const apiDirectory = fileURLToPath(new URL('../../../', import.meta.url));
beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'jixie-publication-'));
  const databaseUrl = `file:${resolve(directory, 'formal.db')}`;
  vi.stubEnv('DATABASE_URL', databaseUrl);
  await writeFile(resolve(directory, 'formal.db'), '');
  execFileSync(
    process.execPath,
    [resolve(apiDirectory, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
    {
      cwd: apiDirectory,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    },
  );
  ({ prisma } = await import('#infra/database/prisma.js'));
  ({ runStagedMaintenance } = await import('./coordinator.js'));
  ({ getMaintenanceStatus } = await import('../runs/state.js'));
}, 30_000);
beforeEach(async () => {
  fixture.prepareFailure = false;
  fixture.prepared = undefined;
  fixture.weather.mockReset().mockResolvedValue([]);
  await prisma.maintenanceRun.deleteMany();
  await prisma.tradeCal.deleteMany();
  await prisma.user.deleteMany();
  await prisma.tradeCal.create({
    data: { exchange: 'SSE', calDate: '20261019', isOpen: 0, pretradeDate: '20261016' },
  });
  await prisma.maintenanceState.upsert({
    where: { key: 'global' },
    create: { key: 'global', dataRevision: 7, dailyPublishedThrough: '20261016' },
    update: { dataRevision: 7, dailyPublishedThrough: '20261016' },
  });
});
afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});
afterAll(async () => {
  await prisma?.$disconnect();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

async function formalOpen(): Promise<number> {
  return (
    await prisma.tradeCal.findUniqueOrThrow({
      where: { exchange_calDate: { exchange: 'SSE', calDate: '20261019' } },
    })
  ).isOpen;
}

describe('candidate preparation and atomic publication', () => {
  it('rejects the obsolete repair flag before creating a candidate or changing the formal database', async () => {
    const { withDatabase } = await import('#infra/database/prisma.js');
    const artifacts = async () =>
      (await readdir(directory))
        .filter((name) => name.startsWith('maintenance') || name.startsWith('owner-'))
        .sort();
    const before = await artifacts();

    await expect(
      withDatabase(prisma, () =>
        runStagedMaintenance('repair', ['20260910', '20260910', '--refresh']),
      ),
    ).rejects.toThrow('remove --refresh');

    expect(await prisma.maintenanceRun.count()).toBe(0);
    expect(await artifacts()).toEqual(before);
    expect(await formalOpen()).toBe(0);
  });

  it('keeps the formal market and user access unchanged on preparation failure', async () => {
    const { withDatabase } = await import('#infra/database/prisma.js');
    return withDatabase(prisma, async () => {
      fixture.prepareFailure = true;
      await expect(
        runStagedMaintenance('sync', ['stock-prices', '20261019', '20261019']),
      ).rejects.toThrow('Injected source failure');
      expect(await formalOpen()).toBe(0);
      expect(await getMaintenanceStatus()).toMatchObject({ active: false, phase: 'error' });
      await withMarketAccess(async () => expect(await formalOpen()).toBe(0));
      const candidates = await readdir(resolve(directory, 'maintenance-staging'));
      expect(candidates.length).toBeGreaterThan(0);
    });
  }, 30_000);

  it('rebuilds a failed candidate whose persistent write capture was removed', async () => {
    const { withDatabase } = await import('#infra/database/prisma.js');
    return withDatabase(prisma, async () => {
      fixture.prepareFailure = true;
      await expect(
        runStagedMaintenance('sync', ['stock-prices', '20261019', '20261019']),
      ).rejects.toThrow('Injected source failure');
      const previous = await prisma.maintenanceRun.findFirstOrThrow();
      const candidate = new DatabaseSync(
        resolve(directory, 'maintenance-staging', previous.id, 'candidate.db'),
      );
      try {
        candidate.exec('DROP TRIGGER _maintenance_track_TradeCal_UPDATE');
      } finally {
        candidate.close();
      }

      fixture.prepareFailure = false;
      await runStagedMaintenance('sync', ['stock-prices', '20261019', '20261019']);
      expect(
        (await prisma.maintenanceRun.findUniqueOrThrow({ where: { id: previous.id } })).summary,
      ).toMatchObject({ phase: 'abandoned' });
      expect(await formalOpen()).toBe(1);
      const published = await prisma.maintenanceRun.findFirstOrThrow({ where: { status: 'done' } });
      expect(published.id).not.toBe(previous.id);
      expect(published.summary).toMatchObject({
        publishedRevision: 8,
        timings: {
          snapshot: expect.any(Number),
          input_changes: expect.any(Number),
          final_changes: expect.any(Number),
          publication: expect.any(Number),
        },
      });
    });
  }, 30_000);

  it('allows phase-one users, excludes private rows, serializes coordinators and commits one revision', async () => {
    const { withDatabase } = await import('#infra/database/prisma.js');
    return withDatabase(prisma, async () => {
      let release!: () => void;
      let ready!: () => void;
      const gate = new Promise<void>((done) => {
        release = done;
      });
      const prepared = new Promise<void>((done) => {
        ready = done;
      });
      fixture.prepared = async () => {
        ready();
        await gate;
      };
      const execution = runStagedMaintenance('sync', ['stock-prices', '20261019', '20261019']);
      await prepared;
      await withMarketAccess(async () => {
        expect(await formalOpen()).toBe(0);
        await prisma.user.create({
          data: { id: 'created-during-preparation', email: 'review@example.invalid' },
        });
      });
      await expect(runStagedMaintenance('weekly', [])).rejects.toBeInstanceOf(
        MarketAccessBusyError,
      );
      const [run] = await prisma.maintenanceRun.findMany();
      const candidate = new DatabaseSync(
        resolve(directory, 'maintenance-staging', run.id, 'candidate.db'),
      );
      try {
        expect(candidate.prepare('SELECT count(*) AS count FROM User').get()?.count).toBe(0);
      } finally {
        candidate.close();
      }
      release();
      await execution;
      expect(await formalOpen()).toBe(1);
      expect(await prisma.user.count()).toBe(1);
      expect(await prisma.maintenanceState.findUnique({ where: { key: 'global' } })).toMatchObject({
        dataRevision: 8,
      });
      expect(
        (await prisma.maintenanceRun.findUniqueOrThrow({ where: { id: run.id } })).summary,
      ).toMatchObject({ phase: 'done', publishedRevision: 8 });
    });
  }, 30_000);

  it('rolls back applied market changes when the publication transaction fails', async () => {
    const { withDatabase } = await import('#infra/database/prisma.js');
    return withDatabase(prisma, async () => {
      const database = new DatabaseSync(resolve(directory, 'formal.db'));
      database.exec(
        "CREATE TRIGGER reject_publication BEFORE UPDATE ON MaintenanceState BEGIN SELECT RAISE(ABORT,'injected transaction failure'); END",
      );
      database.close();
      try {
        await expect(
          runStagedMaintenance('sync', ['stock-prices', '20261019', '20261019']),
        ).rejects.toThrow();
        expect(await formalOpen()).toBe(0);
        expect(
          await prisma.maintenanceState.findUnique({ where: { key: 'global' } }),
        ).toMatchObject({
          dataRevision: 7,
        });
        expect((await getMaintenanceStatus()).active).toBe(false);
        await withMarketAccess(async () => {});
      } finally {
        const cleanup = new DatabaseSync(resolve(directory, 'formal.db'));
        cleanup.exec('DROP TRIGGER reject_publication');
        cleanup.close();
        await prisma.$disconnect();
      }
    });
  }, 30_000);

  it('retries ready publication without redoing preparation', async () => {
    const { withDatabase } = await import('#infra/database/prisma.js');
    await withDatabase(prisma, async () => {
      const { acquireMarketReader } = await import('#infra/coordination/market-access.js');
      const { executeMaintenanceWorkflow } = await import('../workflows/execute.js');
      const prepared = vi.mocked(executeMaintenanceWorkflow);
      prepared.mockClear();
      vi.stubEnv('MAINTENANCE_JOB_DRAIN_TIMEOUT_MS', '100');
      const reader = await acquireMarketReader();
      try {
        await expect(
          runStagedMaintenance('sync', ['stock-prices', '20261019', '20261019']),
        ).rejects.toBeInstanceOf(MarketAccessBusyError);
      } finally {
        await reader.release();
      }
      const first = await prisma.maintenanceRun.findFirstOrThrow();
      expect(first.summary).toMatchObject({ phase: 'ready' });
      await runStagedMaintenance('sync', ['stock-prices', '20261019', '20261019']);
      expect(prepared).toHaveBeenCalledOnce();
      expect(await prisma.maintenanceRun.count()).toBe(1);
      expect(
        (await prisma.maintenanceRun.findUniqueOrThrow({ where: { id: first.id } })).summary,
      ).toMatchObject({ phase: 'done', cleanup: { state: 'complete' } });
    });
  }, 30_000);

  it('cleans a program failure and rebuilds the same frozen target', async () => {
    const { withDatabase } = await import('#infra/database/prisma.js');
    await withDatabase(prisma, async () => {
      fixture.prepared = async () => {
        throw new Error('calculation defect');
      };
      await expect(
        runStagedMaintenance('sync', ['stock-prices', '20261019', '20261019']),
      ).rejects.toThrow('calculation defect');
      const previous = await prisma.maintenanceRun.findFirstOrThrow();
      expect(previous.summary).toMatchObject({
        phase: 'abandoned',
        cleanup: { state: 'complete' },
      });
      expect(await readdir(resolve(directory, 'maintenance-staging'))).not.toContain(previous.id);
      fixture.prepared = undefined;
      await runStagedMaintenance('sync', ['stock-prices', '20261019', '20261019']);
      const next = await prisma.maintenanceRun.findFirstOrThrow({ where: { status: 'done' } });
      const { manifestSchema } = await import('./manifest.js');
      const original = manifestSchema.parse(previous.summary);
      expect(next.summary).toMatchObject({
        timestamp: original.timestamp,
        upperBound: original.upperBound,
        args: original.args,
      });
      expect(
        (await prisma.maintenanceRun.findUniqueOrThrow({ where: { id: previous.id } })).summary,
      ).toMatchObject({ replacementId: next.id });
    });
  }, 30_000);

  it('keeps queued work unclaimed during publication and skips live execution owners during recovery', async () => {
    const { withDatabase } = await import('#infra/database/prisma.js');
    return withDatabase(prisma, async () => {
      const { JobService } = await import('#jobs/job-service.js');
      await prisma.user.create({ data: { id: 'job-owner', email: 'job@example.invalid' } });
      const queued = await JobService.create('job-owner', 'backtest', 'queued', {});
      const { withMaintenanceLock, withMarketPublication } =
        await import('#infra/coordination/market-access.js');
      await withMaintenanceLock(() =>
        withMarketPublication(async () => {
          await expect(JobService.claim(queued)).rejects.toBeInstanceOf(MarketAccessBusyError);
        }),
      );
      expect((await prisma.job.findUniqueOrThrow({ where: { id: queued } })).status).toBe('queued');
      expect(await JobService.claim(queued)).toBe(true);
      try {
        expect(await JobService.recoverInterrupted()).toBe(0);
        expect((await prisma.job.findUniqueOrThrow({ where: { id: queued } })).status).toBe(
          'running',
        );
      } finally {
        // No lifecycle is registered: execution records an expected terminal failure and releases ownership.
        // 不注册生命周期，执行记录预期失败并释放本地所有权。
        await JobService.execute(queued);
      }
      const orphan = await JobService.create('job-owner', 'backtest', 'orphan', {});
      await prisma.job.update({ where: { id: orphan }, data: { status: 'running' } });
      expect(await JobService.recoverInterrupted()).toBe(1);
      expect((await prisma.job.findUniqueOrThrow({ where: { id: orphan } })).status).toBe('stale');
    });
  }, 30_000);

  it('retries committed follow-up work without replaying the market transaction', async () => {
    const { withDatabase } = await import('#infra/database/prisma.js');
    return withDatabase(prisma, async () => {
      fixture.prepared = async () => {
        const { writeFile } = await import('node:fs/promises');
        const [run] = await prisma.maintenanceRun.findMany({ orderBy: { startedAt: 'desc' } });
        await writeFile(
          resolve(directory, 'maintenance-staging', run.id, 'actions.jsonl'),
          '{"kind":"weather"}\n',
        );
      };
      fixture.weather.mockRejectedValueOnce(new Error('Injected post-commit failure'));
      await runStagedMaintenance('daily', []);
      expect(await formalOpen()).toBe(1);
      expect((await getMaintenanceStatus()).active).toBe(false);
      const [run] = await prisma.maintenanceRun.findMany();
      expect(run.summary).toMatchObject({ phase: 'published', publishedRevision: 8 });
      expect(run.stage).toBe('postprocess_error');
      await runStagedMaintenance('daily', ['--resume-only']);
      expect(await prisma.maintenanceState.findUnique({ where: { key: 'global' } })).toMatchObject({
        dataRevision: 8,
      });
      expect(
        (await prisma.maintenanceRun.findUniqueOrThrow({ where: { id: run.id } })).summary,
      ).toMatchObject({ phase: 'done' });
      expect(fixture.weather).toHaveBeenCalledTimes(2);
    });
  }, 30_000);
});
