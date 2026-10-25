import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ directory: '' }));
vi.mock('#infra/database/prisma.js', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { default: exports } = await import('@prisma/client');
  fixture.directory = mkdtempSync('/tmp/jixie-factor-retention-');
  const database = `${fixture.directory}/retention.db`;
  writeFileSync(database, '');
  const mocked = { prisma: new exports.PrismaClient({ datasourceUrl: `file:${database}` }) };
  return {
    ...(await vi.importActual<typeof import('#infra/database/prisma.js')>(
      '#infra/database/prisma.js',
    )),
    ...mocked,
    getDatabase: () => mocked.prisma,
  };
});

import { prisma } from '#infra/database/prisma.js';
import { FactorWorkerError } from '../errors.js';
import { factorAnalysisLifecycle } from './job-lifecycle.js';
import { listFactorReports, readFactorReport } from './read.js';
import { pruneFactorReports } from './retention.js';

async function report(
  id: string,
  createdAt: string,
  options: {
    userId?: string;
    factor?: string;
    jobStatus?: string;
    legacyStatus?: string;
  } = {},
) {
  const userId = options.userId ?? 'owner';

  return prisma.factorReport.create({
    data: {
      id,
      userId,
      factor: options.factor ?? 'factor',
      createdAt: new Date(createdAt),
      freq: 'month',
      start: '20200101',
      end: '20231229',
      legacyStatus: options.jobStatus ? null : (options.legacyStatus ?? 'done'),
      factorCodeSnapshot: 'saved code',
      factorCodeHash: 'saved hash',
      payload: '{"icMean":0.1}',
      ...(options.jobStatus
        ? {
            job: {
              create: {
                id: `job-${id}`,
                userId,
                kind: 'factor-analysis',
                key: id,
                status: options.jobStatus,
                logs: '[{"text":"saved log"}]',
              },
            },
          }
        : {}),
    },
    include: { job: true },
  });
}

async function ids() {
  return (await prisma.factorReport.findMany({ orderBy: { id: 'asc' } })).map((row) => row.id);
}

describe('factor report retention', () => {
  beforeAll(() => {
    execFileSync(
      process.execPath,
      [
        createRequire(import.meta.url).resolve('prisma/build/index.js'),
        'db',
        'push',
        '--skip-generate',
        '--schema',
        resolve('prisma/schema.prisma'),
      ],
      {
        env: { ...process.env, DATABASE_URL: `file:${fixture.directory}/retention.db` },
        stdio: 'pipe',
      },
    );
  }, 30_000);

  beforeEach(async () => {
    await prisma.user.createMany({
      data: [
        { id: 'owner', email: 'owner@fixture.invalid' },
        { id: 'other', email: 'other@fixture.invalid' },
      ],
    });
  });

  afterEach(async () => {
    await prisma.factor.deleteMany();
    await prisma.factorComposite.deleteMany();
    await prisma.factorReport.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await rm(fixture.directory, { recursive: true, force: true });
  });

  it('keeps the latest submission per owner and factor, including a failed latest run', async () => {
    await report('old', '2026-01-01', { jobStatus: 'done' });
    await report('latest-failed', '2026-01-02', { jobStatus: 'error' });
    await report('other-owner', '2026-01-01', { userId: 'other' });
    await report('other-factor', '2026-01-01', { factor: 'another' });

    expect(
      await prisma.$transaction((transaction) =>
        pruneFactorReports(transaction, { userId: 'owner', factor: 'factor' }),
      ),
    ).toBe(1);
    expect(await ids()).toEqual(['latest-failed', 'other-factor', 'other-owner']);
    expect(await prisma.job.findUnique({ where: { id: 'job-old' } })).toBeNull();
    await expect(readFactorReport('owner', 'old')).rejects.toMatchObject({
      reason: 'evaluation_not_found',
    });
    await expect(readFactorReport('other', 'latest-failed')).rejects.toMatchObject({
      reason: 'evaluation_not_found',
    });
    expect(
      (await listFactorReports('owner', { factor: 'factor' })).items.map((row) => row.id),
    ).toEqual(['latest-failed']);
    expect((await readFactorReport('owner', 'latest-failed')).status).toBe('error');
  });

  it('retains publication bindings after archival alongside a newer ordinary analysis', async () => {
    await report('bound', '2026-01-01');
    await report('obsolete', '2026-01-02');
    await report('latest', '2026-01-03');
    await prisma.factor.create({
      data: {
        id: 'factor',
        userId: 'owner',
        key: 'value_v1',
        name: 'Value',
        code: 'saved code',
        status: 'archived',
        approvedReportId: 'bound',
        codeHash: 'saved hash',
      },
    });
    const definition = await prisma.factor.findUniqueOrThrow({ where: { id: 'factor' } });

    expect(await prisma.$transaction((transaction) => pruneFactorReports(transaction))).toBe(1);
    expect(await ids()).toEqual(['bound', 'latest']);
    expect(await prisma.factor.findUniqueOrThrow({ where: { id: 'factor' } })).toEqual(definition);
    expect((await readFactorReport('owner', 'bound')).factorCodeSnapshot).toBe(definition.code);
  });

  it('protects scalar composite publication references while that feature remains', async () => {
    await report('composite-bound', '2026-01-01', { factor: 'composite' });
    await report('composite-latest', '2026-01-02', { factor: 'composite' });
    await prisma.factorComposite.create({
      data: {
        id: 'composite',
        userId: 'owner',
        name: 'Composite',
        definition: {},
        status: 'archived',
        approvedReportId: 'composite-bound',
      },
    });

    expect(
      await prisma.$transaction((transaction) =>
        pruneFactorReports(transaction, { userId: 'owner', factor: 'composite' }),
      ),
    ).toBe(0);
    expect(await ids()).toEqual(['composite-bound', 'composite-latest']);
  });

  it.each(['done', 'error', 'stale'] as const)(
    'prunes an older active run only when it becomes %s',
    async (terminal) => {
      const older = await report('older-active', '2026-01-01', { jobStatus: 'running' });
      await report('newer-active', '2026-01-02', { jobStatus: 'queued' });
      expect(await prisma.$transaction((transaction) => pruneFactorReports(transaction))).toBe(0);
      expect(await ids()).toEqual(['newer-active', 'older-active']);

      await prisma.$transaction(async (transaction) => {
        const job = await transaction.job.update({
          where: { id: older.job!.id },
          data: { status: terminal },
        });
        switch (terminal) {
          case 'done':
            await factorAnalysisLifecycle.onSuccess(transaction, job, {
              reportId: older.id,
              output: '{"icMean":0.2}',
            });
            break;
          case 'error':
            await factorAnalysisLifecycle.onFailure(
              transaction,
              job,
              new FactorWorkerError('failed', new Error('fixture')),
            );
            break;
          case 'stale':
            await factorAnalysisLifecycle.onInterrupted(transaction, job);
            break;
        }
      });

      expect(await ids()).toEqual(['newer-active']);
      expect(await prisma.job.findUnique({ where: { id: older.job!.id } })).toBeNull();
      expect((await readFactorReport('owner', 'newer-active')).status).toBe('running');
    },
  );

  it('prunes existing history globally in bounded batches and is idempotent', async () => {
    await prisma.factorReport.createMany({
      data: Array.from({ length: 260 }, (_, index) => ({
        id: `history-${index.toString().padStart(3, '0')}`,
        userId: 'owner',
        factor: 'factor',
        freq: 'month',
        start: '20200101',
        end: '20231229',
        legacyStatus: 'done',
        createdAt: new Date('2026-01-01'),
      })),
    });
    await report('other-latest', '2026-01-02', { userId: 'other' });
    await report('other-old', '2026-01-01', { userId: 'other' });

    expect(await prisma.$transaction((transaction) => pruneFactorReports(transaction))).toBe(260);
    expect(await ids()).toEqual(['history-259', 'other-latest']);
    expect(await prisma.$transaction((transaction) => pruneFactorReports(transaction))).toBe(0);
  });
});
