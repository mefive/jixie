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
vi.mock('node:child_process', async (original) => {
  const real = await original<typeof import('node:child_process')>();
  const { EventEmitter } = await import('node:events');
  return {
    ...real,
    fork: vi.fn((_entry: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
      const child = new EventEmitter();
      Object.assign(child, {
        kill: () => {
          child.emit('close', 1, 'SIGTERM');
          return true;
        },
      });
      queueMicrotask(() => {
        void (async () => {
          if (args[0] !== 'finalize') {
            const database = new DatabaseSync(options.env.DATABASE_URL!.slice(5));
            try {
              database.exec('UPDATE TradeCal SET isOpen=1');
            } finally {
              database.close();
            }
            await fixture.prepared?.();
            if (fixture.prepareFailure) {
              throw new Error('Injected source failure');
            }
          }
          child.emit('close', 0, null);
        })().catch(() => child.emit('close', 1, null));
      });
      return child;
    }),
  };
});

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
  it('keeps the formal market and user access unchanged on preparation failure', async () => {
    fixture.prepareFailure = true;
    await expect(
      runStagedMaintenance('sync', ['stock-prices', '20261019', '20261019']),
    ).rejects.toThrow('Candidate preparation');
    expect(await formalOpen()).toBe(0);
    expect(await getMaintenanceStatus()).toMatchObject({ active: false, phase: 'error' });
    await withMarketAccess(async () => expect(await formalOpen()).toBe(0));
    const candidates = await readdir(resolve(directory, 'maintenance-staging'));
    expect(candidates.length).toBeGreaterThan(0);
  }, 30_000);

  it('allows phase-one users, excludes private rows, serializes coordinators and commits one revision', async () => {
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
    await expect(runStagedMaintenance('weekly', [])).rejects.toBeInstanceOf(MarketAccessBusyError);
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
  }, 30_000);

  it('rolls back applied market changes when the publication transaction fails', async () => {
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
      expect(await prisma.maintenanceState.findUnique({ where: { key: 'global' } })).toMatchObject({
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
  }, 30_000);

  it('keeps queued work unclaimed during publication and skips live execution owners during recovery', async () => {
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
  }, 30_000);

  it('retries committed follow-up work without replaying the market transaction', async () => {
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
  }, 30_000);
});
