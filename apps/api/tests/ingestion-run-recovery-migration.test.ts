import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { withSyncDatabase } from './sync-database.js';

it('replaces only the unique batch index and retains existing attempts, issues and run identity', async () =>
  withSyncDatabase(async (database) => {
    await database.$executeRawUnsafe(
      'DROP INDEX "IngestionBatch_runId_dataset_scope_period_startedAt_idx"',
    );
    await database.$executeRawUnsafe(
      'CREATE UNIQUE INDEX "IngestionBatch_runId_dataset_scope_period_key" ON "IngestionBatch"("runId", "dataset", "scope", "period")',
    );
    await database.ingestionRun.create({
      data: {
        id: 'existing-run',
        targetDate: '20181231',
        trigger: 'manual',
        scopeSnapshot: { preserved: true },
        status: 'interrupted',
      },
    });
    const original = {
      runId: 'existing-run',
      dataset: 'stock-prices',
      scope: 'SSE,SZSE',
      period: '20181228',
      api: 'daily',
      request: { trade_date: '20181228' },
      status: 'partial',
      acceptedCount: 12,
      rejectedCount: 1,
    };
    await database.ingestionBatch.create({ data: { ...original, id: 'original-attempt' } });
    await database.ingestionIssue.create({
      data: {
        id: 'original-issue',
        runId: 'existing-run',
        batchId: 'original-attempt',
        category: 'record',
        reasonCode: 'fixture',
        message: 'Keep source',
        payload: { open: 1 },
      },
    });
    await expect(
      database.ingestionBatch.create({ data: { ...original, id: 'retry-attempt' } }),
    ).rejects.toThrow();
    const sql = await readFile(
      new URL(
        '../prisma/migrations/20261103031404_ingestion_run_recovery/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    for (const statement of sql
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)) {
      await database.$executeRawUnsafe(statement);
    }
    await database.ingestionBatch.create({
      data: { ...original, id: 'retry-attempt', status: 'succeeded', rejectedCount: 0 },
    });
    expect(await database.ingestionBatch.count()).toBe(2);
    expect(
      await database.ingestionBatch.findUnique({ where: { id: 'original-attempt' } }),
    ).toMatchObject({ status: 'partial', acceptedCount: 12, rejectedCount: 1 });
    expect(await database.ingestionRun.findUnique({ where: { id: 'existing-run' } })).toMatchObject(
      { status: 'interrupted', scopeSnapshot: { preserved: true } },
    );
    expect(
      await database.ingestionIssue.findUnique({ where: { id: 'original-issue' } }),
    ).toMatchObject({ batchId: 'original-attempt', payload: { open: 1 } });
    expect(await database.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([]);
  }));
