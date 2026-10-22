import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StagingManifest } from './manifest.js';
import type { MarketChange } from './changes.js';

// 保留真实影响规划、SQLite、计算 SQL 和派生检查；综合审计在其独立用例覆盖。
// Keep impact planning, SQLite, indicator SQL and derived validation real; audit rules have separate coverage.
const auditFixture = vi.hoisted(() => ({ audit: vi.fn() }));
vi.mock('../publication/audit.js', () => ({ runDataQualityAudit: auditFixture.audit }));
vi.mock('#market/state/sync.js', async (importOriginal) => {
  const implementation = await importOriginal<typeof import('#market/state/sync.js')>();

  return { ...implementation, syncMarketIndicators: vi.fn(implementation.syncMarketIndicators) };
});
let directory: string;
let prisma: (typeof import('#infra/database/prisma.js'))['prisma'];
let finalizeCandidate: (typeof import('./finalize.js'))['finalizeCandidate'];
let computations: typeof import('#market/state/sync.js');
let manifest: StagingManifest;
const targetDates = ['20260731', '20260803', '20260831'];

beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'jixie-finalize-'));
  await writeFile(resolve(directory, 'candidate.db'), '');
  vi.stubEnv('DATABASE_URL', `file:${resolve(directory, 'candidate.db')}`);
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)),
    env: process.env,
    stdio: 'pipe',
  });
  ({ prisma } = await import('#infra/database/prisma.js'));
  computations = await import('#market/state/sync.js');
  ({ finalizeCandidate } = await import('./finalize.js'));
}, 30_000);

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(computations.syncMarketIndicators).mockClear();
  auditFixture.audit.mockReset().mockImplementation(async (_database, options) => ({
    generatedAt: '2026-10-21T00:00:00Z',
    scope: { ...options, openTradingDays: targetDates.length },
    findings: [],
  }));
  await prisma.$transaction([
    prisma.maintenanceRun.deleteMany(),
    prisma.maintenanceState.deleteMany(),
    prisma.marketIndicator.deleteMany(),
    prisma.indexIndicator.deleteMany(),
    prisma.industryIndicator.deleteMany(),
    prisma.daily.deleteMany(),
    prisma.adjFactor.deleteMany(),
    prisma.indexWeight.deleteMany(),
    prisma.indexDaily.deleteMany(),
    prisma.swIndustryMember.deleteMany(),
    prisma.tradeCal.deleteMany(),
  ]);
  const allDates = ['20150105', '20260730', ...targetDates];
  await prisma.tradeCal.createMany({
    data: allDates.map((calDate) => ({ exchange: 'SSE', calDate, isOpen: 1 })),
  });
  const stocks = Array.from(
    { length: 20 },
    (_, index) => `${String(index + 1).padStart(6, '0')}.SZ`,
  );
  await prisma.daily.createMany({
    data: stocks.flatMap((tsCode) =>
      allDates.map((tradeDate) => ({ tsCode, tradeDate, close: 10, pctChg: 0 })),
    ),
  });
  await prisma.adjFactor.createMany({
    data: stocks.flatMap((tsCode) =>
      allDates.map((tradeDate) => ({ tsCode, tradeDate, adjFactor: 1 })),
    ),
  });
  await prisma.swIndustryMember.createMany({
    data: stocks.map((tsCode, index) => ({
      tsCode,
      l1Code: `SW${index}`,
      l1Name: `Industry ${index}`,
      inDate: '20100101',
    })),
  });
  await prisma.indexWeight.createMany({
    data: [
      { indexCode: '000906.SH', conCode: stocks[0], tradeDate: '20150105', weight: 100 },
      { indexCode: '000300.SH', conCode: stocks[0], tradeDate: '20260731', weight: 100 },
    ],
  });
  await prisma.indexDaily.createMany({
    data: ['000906.SH', '000300.SH'].flatMap((tsCode) =>
      targetDates.map((tradeDate) => ({ tsCode, tradeDate, close: 100 })),
    ),
  });
  await prisma.marketIndicator.create({
    data: { tradeDate: '20150105', tradedCount: 777, limitUpCount: 0, limitDownCount: 0 },
  });
  await prisma.maintenanceState.create({
    data: { key: 'global', dataRevision: 4, dailyPublishedThrough: '20260730' },
  });
  await prisma.maintenanceRun.create({
    data: {
      id: 'REPAIR',
      kind: 'repair',
      targetKey: 'fixture',
      trigger: 'manual',
      status: 'done',
      stage: 'prepared',
      startDate: targetDates[0],
      endDate: targetDates.at(-1)!,
      summary: { completedDates: 3, audit: null },
    },
  });
  manifest = {
    protocol: 2,
    id: 'CASE',
    command: 'repair',
    args: [targetDates[0], targetDates.at(-1)!, '--refresh'],
    timestamp: '2026-10-21T00:00:00Z',
    date: '20261021',
    upperBound: '20261020',
    phase: 'preparing',
    rulesHash: 'fixture',
    requirementsHash: 'fixture',
    snapshot: { schemaHash: 'fixture', baseRevision: 4, tables: [] },
    changes: [],
    actions: [],
    completedActions: [],
  };
});

afterAll(async () => {
  await prisma?.$disconnect();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (directory) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function freeze(table: string, changes: MarketChange[]) {
  await writeFile(
    resolve(directory, `${table}.changes`),
    changes.map((change) => JSON.stringify(change)).join('\n') + '\n',
  );
  manifest.changes.push({ table, count: changes.length, hash: 'fixture' });
}
async function finalize() {
  await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(manifest));
  const { withDatabase } = await import('#infra/database/prisma.js');
  const { withStagingContext } = await import('#infra/coordination/staging-input.js');
  await withStagingContext(
    {
      ...manifest,
      directory,
      formalUrl: process.env.DATABASE_URL!,
      requirements: { active: [], versioned: [] },
    },
    () => withDatabase(prisma, finalizeCandidate),
  );
}

describe('candidate finalization on migrated SQLite', () => {
  it('retains baseline computation when a later daily record only schedules signals', async () => {
    manifest.command = 'daily';
    manifest.args = [];
    await prisma.maintenanceRun.createMany({
      data: [
        {
          id: 'BASELINE',
          kind: 'daily',
          targetKey: 'baseline:20260731',
          trigger: 'manual',
          status: 'done',
          stage: 'prepared',
          startDate: '20260731',
          endDate: '20260731',
          startedAt: new Date('2026-10-21T01:00:00Z'),
          summary: { startDate: '20260731', readyThrough: '20260731' },
        },
        {
          id: 'SIGNALS',
          kind: 'daily',
          targetKey: '20260831',
          trigger: 'manual',
          status: 'done',
          stage: 'prepared',
          startedAt: new Date('2026-10-21T02:00:00Z'),
          summary: { startDate: null, readyThrough: '20260831', completedDates: 0 },
        },
      ],
    });
    const compute = vi.mocked(computations.syncMarketIndicators);

    await finalize();

    expect(compute).toHaveBeenCalledWith('20260731', '20260831', expect.anything());
    expect(await prisma.marketIndicator.count({ where: { tradeDate: { gte: '20260731' } } })).toBe(
      3,
    );
  });

  it('computes the repair once, audits beyond the old watermark and leaves unrelated old gaps intact', async () => {
    await freeze('StockBasic', [
      { operation: 'insert', row: { tsCode: 'NEW', name: 'New stock' } },
    ]);
    const compute = vi.mocked(computations.syncMarketIndicators);
    await finalize();
    expect(compute).toHaveBeenCalledOnce();
    expect(compute).toHaveBeenCalledWith('20260731', '20260831', expect.anything());
    expect(
      await prisma.marketIndicator.findUnique({ where: { tradeDate: '20150105' } }),
    ).toMatchObject({ tradedCount: 777 });
    expect(await prisma.indexIndicator.count({ where: { tradeDate: '20150105' } })).toBe(0);
    expect(await prisma.indexIndicator.count()).toBe(6);
    expect(auditFixture.audit).toHaveBeenCalledOnce();
    expect(auditFixture.audit.mock.calls[0][0] === prisma).toBe(true);
    expect(auditFixture.audit.mock.calls[0][1]).toMatchObject({
      startDate: '20260731',
      endDate: '20260831',
    });
    const run = await prisma.maintenanceRun.findUniqueOrThrow({ where: { id: 'REPAIR' } });
    expect(run.summary).toMatchObject({ audit: { scope: { endDate: '20260831' }, findings: [] } });
    expect(JSON.parse(await readFile(resolve(directory, 'audit.json'), 'utf8'))).toMatchObject({
      scope: { endDate: '20260831' },
    });
    expect(await prisma.maintenanceState.findUnique({ where: { key: 'global' } })).toMatchObject({
      dailyPublishedThrough: '20260730',
      dataRevision: 4,
    });
  });

  it('recomputes a real historical membership change only for its index', async () => {
    await prisma.indexWeight.create({
      data: { indexCode: '000300.SH', conCode: '000001.SZ', tradeDate: '20150105', weight: 100 },
    });
    await prisma.indexDaily.createMany({
      data: ['20150105', '20260730'].map((tradeDate) => ({
        tsCode: '000300.SH',
        tradeDate,
        close: 100,
      })),
    });
    await freeze('IndexWeight', [
      {
        operation: 'insert',
        row: { indexCode: '000300.SH', conCode: '000001.SZ', tradeDate: '20150105', weight: 100 },
      },
    ]);
    await finalize();
    expect(
      await prisma.indexIndicator.count({
        where: { indexCode: '000300.SH', tradeDate: { lt: '20260731' } },
      }),
    ).toBe(2);
    expect(
      await prisma.indexIndicator.count({
        where: { indexCode: '000906.SH', tradeDate: { lt: '20260731' } },
      }),
    ).toBe(0);
    expect(
      await prisma.marketIndicator.findUnique({ where: { tradeDate: '20150105' } }),
    ).toMatchObject({ tradedCount: 777 });
  });

  it('still rejects a missing price needed by a genuine historical change', async () => {
    await prisma.indexWeight.create({
      data: { indexCode: '000300.SH', conCode: '000001.SZ', tradeDate: '20150105', weight: 100 },
    });
    await freeze('IndexWeight', [
      {
        operation: 'insert',
        row: { indexCode: '000300.SH', conCode: '000001.SZ', tradeDate: '20150105', weight: 100 },
      },
    ]);
    await expect(finalize()).rejects.toThrow('IndexIndicator has 0 rows');
    expect(auditFixture.audit).not.toHaveBeenCalled();
  });

  it('retains the full failed audit instead of producing a publication success', async () => {
    auditFixture.audit.mockResolvedValue({
      generatedAt: 'fixture',
      scope: { startDate: '20260731', endDate: '20260831' },
      findings: [{ status: 'error', title: 'invalid source' }],
    });
    await expect(finalize()).rejects.toThrow('invalid source');
    expect(
      (await prisma.maintenanceRun.findUniqueOrThrow({ where: { id: 'REPAIR' } })).summary,
    ).toMatchObject({ audit: { findings: [{ status: 'error' }] } });
  });
});
