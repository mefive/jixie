import { execFileSync, spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import prismaPackage from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ directory: '' }));
vi.mock('#infra/database/prisma.js', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { default: packageExports } = await import('@prisma/client');
  fixture.directory = mkdtempSync('/tmp/jixie-factor-job-migration-');
  const databasePath = `${fixture.directory}/jobs.db`;
  writeFileSync(databasePath, '');
  return { prisma: new packageExports.PrismaClient({ datasourceUrl: `file:${databasePath}` }) };
});

import { prisma } from '#infra/database/prisma.js';
import { migrateLegacyFactorJobs } from './split-factor-job-kinds.js';

const { Prisma: prismaValues } = prismaPackage;

describe('legacy Factor Job migration', () => {
  beforeAll(() => {
    const require = createRequire(import.meta.url);
    execFileSync(
      process.execPath,
      [
        require.resolve('prisma/build/index.js'),
        'db',
        'push',
        '--skip-generate',
        '--schema',
        resolve('prisma/schema.prisma'),
      ],
      {
        env: { ...process.env, DATABASE_URL: `file:${join(fixture.directory, 'jobs.db')}` },
        stdio: 'pipe',
      },
    );
  }, 30_000);

  beforeEach(async () => {
    await prisma.job.deleteMany();
    await prisma.factorReport.deleteMany();
    await prisma.factorCorrelation.deleteMany();
    await prisma.user.deleteMany();
    await prisma.user.create({ data: { id: 'owner', email: 'owner@example.com' } });
  });

  afterEach(async () => {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS reject_factor_kind_migration');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await rm(fixture.directory, { recursive: true, force: true });
  });

  it('converts every status while preserving frozen inputs, links, logs, reports and caches', async () => {
    const variants = [
      { payload: { task: 'analysis', reportId: 'report' }, kind: 'factor-analysis' },
      { payload: { task: 'correlation', keys: ['ep', 'bp'] }, kind: 'factor-correlation' },
      { payload: {}, kind: 'factor-analysis' },
      { payload: prismaValues.DbNull, kind: 'factor-analysis' },
      { payload: ['invalid'], kind: 'factor-analysis' },
      { payload: 'invalid', kind: 'factor-analysis' },
    ];
    const expectedKinds = new Map<string, string>();
    const timestamp = new Date('2025-01-01T00:00:00Z');
    for (const status of ['queued', 'running', 'done', 'error', 'stale']) {
      for (const [index, variant] of variants.entries()) {
        const id = `${status}-${index}`;
        expectedKinds.set(id, variant.kind);
        await prisma.job.create({
          data: {
            id,
            userId: 'owner',
            kind: 'factor',
            key: 'fixture',
            status,
            payload: variant.payload,
            logs: '[{"text":"saved log"}]',
            error: 'saved error',
            queuedAt: timestamp,
            startedAt: timestamp,
            finishedAt: timestamp,
          },
        });
      }
    }
    await prisma.job.createMany({
      data: ['backtest', 'factor-analysis', 'factor-correlation'].map((kind) => ({
        id: kind,
        userId: 'owner',
        kind,
        key: 'current',
        status: 'queued',
      })),
    });
    const report = await prisma.factorReport.create({
      data: {
        id: 'report',
        userId: 'owner',
        factor: 'fixture',
        status: 'done',
        freq: 'month',
        start: '20200101',
        end: '20231229',
        payload: '{"score":1}',
      },
    });
    await prisma.job.update({ where: { id: 'done-0' }, data: { factorReportId: report.id } });
    const cache = await prisma.factorCorrelation.create({
      data: { id: 'cache', userId: 'owner', payload: '{"correlation":0.5}', computedAt: timestamp },
    });
    const before = await prisma.job.findMany({ orderBy: { id: 'asc' } });

    await migrateLegacyFactorJobs(prisma);

    const after = await prisma.job.findMany({ orderBy: { id: 'asc' } });
    expect(after).toEqual(
      before.map((job) =>
        expectedKinds.has(job.id)
          ? {
              ...job,
              kind: expectedKinds.get(job.id),
              updatedAt: expect.any(Date),
            }
          : job,
      ),
    );
    expect(await prisma.factorReport.findUnique({ where: { id: report.id } })).toEqual(report);
    expect(await prisma.factorCorrelation.findUnique({ where: { id: cache.id } })).toEqual(cache);

    await migrateLegacyFactorJobs(prisma);
    expect(await prisma.job.findMany({ orderBy: { id: 'asc' } })).toEqual(after);
  });

  it('rolls back a failed batch and resumes after previously committed batches', async () => {
    await prisma.job.createMany({
      data: Array.from({ length: 205 }, (_, index) => ({
        id: `legacy-${String(index).padStart(4, '0')}`,
        userId: 'owner',
        kind: 'factor',
        key: 'fixture',
        status: 'queued',
        payload: { task: index % 2 === 0 ? 'correlation' : 'analysis' },
      })),
    });
    await prisma.$executeRawUnsafe(
      "CREATE TRIGGER reject_factor_kind_migration BEFORE UPDATE OF kind ON Job WHEN OLD.id = 'legacy-0200' BEGIN SELECT RAISE(ABORT, 'migration rejected'); END",
    );

    await expect(migrateLegacyFactorJobs(prisma)).rejects.toMatchObject({ code: 'P2003' });
    expect(await prisma.job.count({ where: { kind: 'factor-analysis' } })).toBe(100);
    expect(await prisma.job.count({ where: { kind: 'factor-correlation' } })).toBe(100);
    expect(
      await prisma.job.findMany({
        where: { kind: 'factor' },
        orderBy: { id: 'asc' },
        select: { id: true },
      }),
    ).toEqual(Array.from({ length: 5 }, (_, index) => ({ id: `legacy-020${index}` })));

    await prisma.$executeRawUnsafe('DROP TRIGGER reject_factor_kind_migration');
    await migrateLegacyFactorJobs(prisma);
    expect(await prisma.job.count({ where: { kind: 'factor' } })).toBe(0);
    expect(await prisma.job.count({ where: { kind: 'factor-analysis' } })).toBe(102);
    expect(await prisma.job.count({ where: { kind: 'factor-correlation' } })).toBe(103);
    expect(await prisma.job.count({ where: { status: 'queued' } })).toBe(205);
  });

  it('runs as a standalone migration and exits unsuccessfully on a database failure', async () => {
    await prisma.job.create({
      data: {
        id: 'legacy',
        userId: 'owner',
        kind: 'factor',
        key: 'fixture',
        status: 'queued',
        payload: { task: 'correlation' },
      },
    });
    const invoke = () =>
      spawnSync(
        process.execPath,
        ['--import', 'tsx', resolve('scripts/migrations/split-factor-job-kinds.ts')],
        {
          env: { ...process.env, DATABASE_URL: `file:${join(fixture.directory, 'jobs.db')}` },
          encoding: 'utf8',
          timeout: 10_000,
        },
      );
    await prisma.$executeRawUnsafe(
      "CREATE TRIGGER reject_factor_kind_migration BEFORE UPDATE OF kind ON Job BEGIN SELECT RAISE(ABORT, 'migration rejected'); END",
    );
    const failed = invoke();
    expect(failed.status, failed.stderr).toBe(1);
    expect(failed.stderr).toContain('Factor Job kind migration failed');
    expect(await prisma.job.findUnique({ where: { id: 'legacy' } })).toMatchObject({
      kind: 'factor',
    });

    await prisma.$executeRawUnsafe('DROP TRIGGER reject_factor_kind_migration');
    const succeeded = invoke();
    expect(succeeded.status, succeeded.stderr).toBe(0);
    expect(await prisma.job.findUnique({ where: { id: 'legacy' } })).toMatchObject({
      kind: 'factor-correlation',
      status: 'queued',
    });
  });
});
