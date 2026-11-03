import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { withSyncDatabase } from './sync-database.js';

it('preserves original diagnostic values and relations while defaulting their severity to error', async () =>
  withSyncDatabase(async (database, directory) => {
    await database.$executeRawUnsafe('ALTER TABLE "IngestionIssue" DROP COLUMN "severity"');
    await database.ingestionRun.create({
      data: {
        id: 'legacy-run',
        targetDate: '20181231',
        trigger: 'manual',
        status: 'interrupted',
        scopeSnapshot: { preserved: true },
      },
    });
    await database.ingestionBatch.create({
      data: {
        id: 'legacy-batch',
        runId: 'legacy-run',
        dataset: 'stock-prices',
        scope: 'SSE,SZSE',
        period: '19911107',
        api: 'daily',
        request: {},
        status: 'partial',
        rejectedCount: 1,
      },
    });
    const raw = {
      ts_code: '000003.SZ',
      trade_date: '19911107',
      open: 15.5,
      high: 18.3,
      low: 17.5,
      close: 17.7,
    };
    await database.$executeRaw`INSERT INTO "IngestionIssue" ("id", "runId", "batchId", "category", "reasonCode", "message", "businessKey", "payload", "createdAt") VALUES ('legacy-issue', 'legacy-run', 'legacy-batch', 'record', 'record_not_accepted', 'Inconsistent OHLC price range', ${JSON.stringify({ tsCode: raw.ts_code, tradeDate: raw.trade_date })}, ${JSON.stringify(raw)}, 1793664000000)`;
    const sql = await readFile(
      new URL(
        '../prisma/migrations/20261103050901_ingestion_warning_severity/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const sqlite = new DatabaseSync(join(directory, 'test.db'));
    try {
      sqlite.exec(sql);
    } finally {
      sqlite.close();
    }
    expect(
      await database.ingestionIssue.findUnique({ where: { id: 'legacy-issue' } }),
    ).toMatchObject({
      runId: 'legacy-run',
      batchId: 'legacy-batch',
      severity: 'error',
      category: 'record',
      reasonCode: 'record_not_accepted',
      message: 'Inconsistent OHLC price range',
      businessKey: { tsCode: raw.ts_code, tradeDate: raw.trade_date },
      payload: raw,
      createdAt: new Date(1793664000000),
    });
    expect(
      await database.ingestionBatch.findUnique({ where: { id: 'legacy-batch' } }),
    ).toMatchObject({ status: 'partial', rejectedCount: 1 });
    expect(await database.ingestionRun.findUnique({ where: { id: 'legacy-run' } })).toMatchObject({
      status: 'interrupted',
      scopeSnapshot: { preserved: true },
    });
    await database.ingestionIssue.create({
      data: {
        id: 'warning',
        runId: 'legacy-run',
        batchId: 'legacy-batch',
        severity: 'warning',
        category: 'record',
        reasonCode: 'ohlc_range_inconsistent',
        message: 'Inconsistent OHLC price range',
        payload: raw,
      },
    });
    expect(await database.ingestionIssue.count({ where: { severity: 'warning' } })).toBe(1);
    expect(await database.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([]);
  }));
