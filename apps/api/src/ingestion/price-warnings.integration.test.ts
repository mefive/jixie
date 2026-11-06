import { expect, it } from 'vitest';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { emptySelections, ingestionSource } from '../../tests/ingestion-source.js';
import type { SyncSource } from '#market/synchronization/source.js';
import { ingest } from './ingest.js';
import { getIngestionStatus } from './status.js';

const date = '19911107';
const time = new Date('1991-11-09T10:00:00Z');
const historicalBar = {
  ts_code: '000003.SZ',
  trade_date: date,
  open: 15.5,
  high: 18.3,
  low: 17.5,
  close: 17.7,
  pre_close: 17.45,
  pct_chg: 1.43,
  vol: 1044,
  amount: 9372,
};

/**
 * 复用正式来源夹具，只收窄日历并加入真实历史 OHLC 矛盾。
 *
 * Reuse the formal source fixture with a narrow calendar and the observed historical OHLC conflict.
 */
function warningSource(includeError = false): SyncSource {
  const base = ingestionSource();

  return {
    call: async (api, params = {}, fields) => {
      if (api === 'trade_cal') {
        return date >= String(params.start_date) && date <= String(params.end_date)
          ? [{ exchange: String(params.exchange), cal_date: date, is_open: 1 }]
          : [];
      }
      if (api === 'daily') {
        return [
          ...(includeError
            ? [{ ts_code: '600000.SH', trade_date: date, open: 0, high: 11, low: 9, close: 10 }]
            : []),
          historicalBar,
        ];
      }
      if (api === 'stock_basic' && params.list_status === 'D') {
        return [
          {
            ts_code: historicalBar.ts_code,
            symbol: '000003',
            name: 'PT金田A(退)',
            exchange: 'SZSE',
            list_date: '19910703',
            delist_date: '20020614',
            list_status: 'D',
          },
        ];
      }

      return base.call(api, params, fields);
    },
  };
}

it(
  'accepts the observed PT Jintian prices, commits a warning atomically and completes the run',
  async () =>
    withSyncDatabase(async (database) => {
      await emptySelections(database);
      const logs: string[] = [];
      const result = await ingest({
        targetDate: date,
        clock: () => time,
        onLog: (line) => logs.push(line),
        source: warningSource(),
      });
      expect(result).toMatchObject({
        status: 'completed',
        issues: 0,
        warnings: 1,
        partial: 0,
        failed: 0,
        rejected: 0,
      });
      expect(
        await database.daily.findUnique({
          where: { tsCode_tradeDate: { tsCode: historicalBar.ts_code, tradeDate: date } },
        }),
      ).toMatchObject({ open: 15.5, high: 18.3, low: 17.5, close: 17.7 });
      const batch = await database.ingestionBatch.findFirstOrThrow({
        where: { runId: result.runId, dataset: 'stock-prices' },
      });
      expect(batch).toMatchObject({
        status: 'succeeded',
        receivedCount: 1,
        acceptedCount: 1,
        rejectedCount: 0,
      });
      expect(
        await database.ingestionIssue.findFirst({ where: { batchId: batch.id } }),
      ).toMatchObject({
        severity: 'warning',
        category: 'record',
        reasonCode: 'ohlc_range_inconsistent',
        businessKey: { tsCode: historicalBar.ts_code, tradeDate: date },
        payload: historicalBar,
      });
      expect(await getIngestionStatus()).toMatchObject({ error: null });
      expect(await database.ingestionIssueResolution.count({ where: { status: 'pending' } })).toBe(
        1,
      );
      expect(logs.some((line) => line.includes('[warning]'))).toBe(true);
    }),
  60_000,
);

it(
  'counts mixed warnings and errors separately and keeps the actual error visible',
  async () =>
    withSyncDatabase(async (database) => {
      await emptySelections(database);
      const result = await ingest({
        targetDate: date,
        clock: () => time,
        onLog: () => {},
        source: warningSource(true),
      });
      expect(result).toMatchObject({
        status: 'completed_with_issues',
        issues: 1,
        warnings: 1,
        partial: 1,
        rejected: 1,
      });
      expect(await database.daily.count()).toBe(1);
      expect(
        await database.ingestionBatch.findFirst({
          where: { runId: result.runId, dataset: 'stock-prices' },
        }),
      ).toMatchObject({ receivedCount: 2, acceptedCount: 1, rejectedCount: 1, status: 'partial' });
      expect(await getIngestionStatus()).toMatchObject({ error: 'Missing or invalid OHLC price' });
      expect(
        await database.ingestionIssue.count({ where: { runId: result.runId, severity: 'error' } }),
      ).toBe(1);
    }),
  60_000,
);

it(
  'retries the old rejected batch in its original run while retaining its historical error',
  async () =>
    withSyncDatabase(async (database) => {
      await emptySelections(database);
      const runId = '00000000000000000000000001';
      await database.ingestionRun.create({
        data: {
          id: runId,
          targetDate: date,
          trigger: 'manual',
          scopeSnapshot: {},
          status: 'interrupted',
          startedAt: new Date('1991-11-08T10:00:00Z'),
        },
      });
      await database.ingestionBatch.create({
        data: {
          id: 'old-price-batch',
          runId,
          dataset: 'stock-prices',
          scope: 'SSE,SZSE',
          period: date,
          api: 'daily',
          request: {},
          rangeStart: date,
          rangeEnd: date,
          responseComplete: true,
          status: 'partial',
          rejectedCount: 1,
          startedAt: new Date('1991-11-08T10:00:00Z'),
        },
      });
      await database.ingestionIssue.create({
        data: {
          id: 'old-price-error',
          runId,
          batchId: 'old-price-batch',
          category: 'record',
          reasonCode: 'record_not_accepted',
          message: 'Inconsistent OHLC price range',
          payload: historicalBar,
        },
      });
      const result = await ingest({
        targetDate: date,
        clock: () => time,
        onLog: () => {},
        source: warningSource(),
      });
      expect(result).toMatchObject({
        runId,
        status: 'completed',
        issues: 0,
        warnings: 1,
        rejected: 0,
      });
      expect(
        await database.ingestionIssue.findUnique({ where: { id: 'old-price-error' } }),
      ).toMatchObject({ severity: 'error', payload: historicalBar });
      expect(
        await database.ingestionBatch.findUnique({ where: { id: 'old-price-batch' } }),
      ).toMatchObject({ status: 'partial', rejectedCount: 1 });
      expect(await database.ingestionIssue.count({ where: { runId, severity: 'warning' } })).toBe(
        1,
      );
    }),
  60_000,
);

it(
  'rolls prices and the success receipt back if the warning cannot be persisted',
  async () =>
    withSyncDatabase(async (database) => {
      await emptySelections(database);
      await database.$executeRawUnsafe(
        `CREATE TRIGGER refuse_warning BEFORE INSERT ON "IngestionIssue" WHEN NEW.severity='warning' BEGIN SELECT RAISE(ABORT, 'controlled warning publication failure'); END`,
      );
      const input = {
        targetDate: date,
        clock: () => time,
        onLog: () => {},
        source: warningSource(),
      };
      const failed = await ingest(input);
      expect(failed.status).toBe('failed');
      expect(await database.daily.count()).toBe(0);
      expect(
        await database.ingestionBatch.count({
          where: { runId: failed.runId, dataset: 'stock-prices', status: 'succeeded' },
        }),
      ).toBe(0);
      await database.$executeRawUnsafe('DROP TRIGGER refuse_warning');
      expect(await ingest(input)).toMatchObject({
        runId: failed.runId,
        status: 'completed',
        issues: 0,
        warnings: 1,
      });
      expect(await database.daily.count()).toBe(1);
    }),
  60_000,
);
