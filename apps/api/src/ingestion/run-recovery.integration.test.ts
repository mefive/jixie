import { expect, it } from 'vitest';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { emptySelections, ingestionSource, ingestionTime } from '../../tests/ingestion-source.js';
import { ingest } from './ingest.js';
import { getIngestionStatus } from './status.js';
import { runPlanSchema } from './schema.js';

it(
  'waits for a complete stock catalog before financial discovery and rebuilds the dependent plan on recovery',
  async () =>
    withSyncDatabase(async (database) => {
      await emptySelections(database);
      let fail = true;
      let financialRequests = 0;
      const fallback = ingestionSource({ incomeAvailable: () => true });
      const input = {
        targetDate: '19910104',
        clock: () => ingestionTime,
        onLog: () => {},
        source: {
          call: async (api: string, params: Record<string, unknown> = {}, fields?: string) => {
            if (api === 'stock_basic' && params.list_status === 'L' && fail) {
              throw new Error('Controlled catalog failure');
            }
            if (api.endsWith('_vip') || api === 'dividend') {
              financialRequests++;
            }

            return fallback.call(api, params, fields);
          },
        },
      };
      const first = await ingest(input);
      expect(first.status).toBe('completed_with_issues');
      expect(financialRequests).toBe(0);
      fail = false;
      const resumed = await ingest(input);
      expect(resumed).toMatchObject({ runId: first.runId, status: 'completed', issues: 0 });
      expect(financialRequests).toBeGreaterThan(0);
      expect(await database.financialIncomeStatement.count()).toBe(1);
    }),
  60_000,
);

it(
  'filters future securities before validating bulk financial rows without dropping eligible pre-IPO reports',
  async () =>
    withSyncDatabase(async (database) => {
      await emptySelections(database);
      const base = ingestionSource({ incomeAvailable: () => true, incomePeriod: '19881231' });
      const result = await ingest({
        targetDate: '19910104',
        clock: () => ingestionTime,
        onLog: () => {},
        source: {
          call: async (api, params, fields) => {
            const rows = await base.call(api, params, fields);
            if (api === 'stock_basic' && params?.list_status === 'L') {
              return [
                ...rows,
                {
                  ts_code: '600001.SH',
                  symbol: '600001',
                  name: 'Future',
                  list_status: 'L',
                  exchange: 'SSE',
                  list_date: '20200101',
                  delist_date: null,
                },
              ];
            }
            if (api === 'income_vip') {
              return [...rows, { ts_code: '600001.SH', end_date: 'bad', comp_type: 'unknown' }];
            }

            return rows;
          },
        },
      });
      expect(result.status).toBe('completed');
      expect(await database.ingestionIssue.count()).toBe(0);
      expect(await database.financialIncomeStatement.findMany()).toMatchObject([
        { tsCode: '600000.SH', endDate: '19881231' },
      ]);
    }),
  60_000,
);

it(
  'resumes financial successes in the same run, then refreshes only after completion creates a new run',
  async () =>
    withSyncDatabase(async (database) => {
      await emptySelections(database);
      const controller = new AbortController();
      const first = await ingest({
        targetDate: '19910104',
        clock: () => ingestionTime,
        onLog: () => {},
        signal: controller.signal,
        source: ingestionSource({
          incomeAvailable: () => true,
          onCall: (api) => {
            if (api === 'dividend') {
              controller.abort();
            }
          },
        }),
      });
      expect(first.status).toBe('interrupted');
      const saved = await database.financialIncomeStatement.findFirstOrThrow();
      const succeeded = await database.ingestionBatch.findMany({
        where: { runId: first.runId, status: 'succeeded' },
      });
      const calls: Array<{ api: string; params: Record<string, unknown> }> = [];
      const input = {
        targetDate: '19910104',
        clock: () => new Date('1991-01-10T10:00:00Z'),
        onLog: () => {},
        source: ingestionSource({
          incomeAvailable: () => true,
          onCall: (api, params) => calls.push({ api, params }),
        }),
      };
      const resumed = await ingest(input);
      expect(resumed).toMatchObject({ runId: first.runId, status: 'completed', issues: 0 });
      expect(calls.some((call) => call.api.endsWith('_vip'))).toBe(false);
      expect(calls.some((call) => call.api === 'stock_basic' || call.api === 'trade_cal')).toBe(
        false,
      );
      expect(calls.some((call) => call.api === 'dividend')).toBe(true);
      expect(await database.ingestionRun.count()).toBe(1);
      expect(
        (await database.ingestionRun.findUniqueOrThrow({ where: { id: first.runId } })).startedAt,
      ).toEqual(ingestionTime);
      expect(
        await database.ingestionBatch.count({
          where: { id: { in: succeeded.map((batch) => batch.id) }, status: 'succeeded' },
        }),
      ).toBe(succeeded.length);
      expect(
        await database.ingestionBatch.count({
          where: { runId: first.runId, dataset: 'dividends' },
        }),
      ).toBe(2);
      expect(
        await database.ingestionBatch.count({
          where: {
            runId: first.runId,
            dataset: 'dividends',
            status: 'interrupted',
          },
        }),
      ).toBe(1);
      expect((await getIngestionStatus()).error).toBeNull();

      calls.length = 0;
      const next = await ingest(input);
      expect(next.status).toBe('completed');
      expect(next.runId).not.toBe(first.runId);
      expect(calls.some((call) => call.api === 'income_vip' && !call.params.period)).toBe(true);
      expect(
        calls.some((call) => call.api === 'income_vip' && call.params.period === '19901231'),
      ).toBe(true);
      expect((await database.financialIncomeStatement.findFirstOrThrow()).observedAt).toEqual(
        saved.observedAt,
      );
    }),
  60_000,
);

it(
  'retries only the partial daily batch, retaining its original issue but reporting the successful repair',
  async () =>
    withSyncDatabase(async (database) => {
      await emptySelections(database);
      const first = await ingest({
        targetDate: '19901219',
        clock: () => ingestionTime,
        onLog: () => {},
        source: ingestionSource({
          prices: (date) => [
            { ts_code: '600000.SH', trade_date: date, open: 0, high: 11, low: 9, close: 10 },
          ],
        }),
      });
      expect(first.status).toBe('completed_with_issues');
      const issue = await database.ingestionIssue.findFirstOrThrow({
        where: { runId: first.runId },
      });
      const calls: string[] = [];
      const result = await ingest({
        targetDate: '19901219',
        clock: () => ingestionTime,
        onLog: () => {},
        source: ingestionSource({ onCall: (api) => calls.push(api) }),
      });
      expect(result).toMatchObject({
        runId: first.runId,
        status: 'completed',
        issues: 0,
        partial: 0,
        rejected: 0,
      });
      expect(calls).toEqual(['daily']);
      expect(await database.ingestionIssue.findUnique({ where: { id: issue.id } })).not.toBeNull();
      expect(
        await database.ingestionBatch.count({
          where: { runId: first.runId, dataset: 'stock-prices' },
        }),
      ).toBe(2);
      expect((await getIngestionStatus()).error).toBeNull();
    }),
  60_000,
);

it(
  'does not publish a truncated period catalog and resumes its failed discovery without reloading successful catalogs',
  async () =>
    withSyncDatabase(async (database) => {
      await emptySelections(database);
      let fail = true;
      const requests: Array<{ api: string; params: Record<string, unknown> }> = [];
      const fallback = ingestionSource({ incomeAvailable: () => true, incomePeriod: '19881231' });
      const input = {
        targetDate: '19910104',
        clock: () => ingestionTime,
        onLog: () => {},
        source: {
          call: async (api: string, params: Record<string, unknown> = {}, fields?: string) => {
            requests.push({ api, params });
            if (api === 'income_vip' && params.report_type === '1' && !params.period) {
              if (fail && params.offset) {
                throw new Error('Controlled catalog page failure');
              }
              if (fail) {
                return Array.from({ length: 5000 }, () => ({
                  ts_code: '600000.SH',
                  end_date: '19881231',
                }));
              }
            }

            return fallback.call(api, params, fields);
          },
        },
      };
      const first = await ingest(input);
      expect(first.status).toBe('completed_with_issues');
      const snapshot = runPlanSchema.parse(
        (await database.ingestionRun.findUniqueOrThrow({ where: { id: first.runId } }))
          .scopeSnapshot,
      );
      expect(snapshot.financialPeriods).not.toHaveProperty('income|1');
      expect(await database.financialIncomeStatement.count()).toBe(0);
      expect(await database.daily.count()).toBeGreaterThan(0);

      fail = false;
      requests.length = 0;
      const resumed = await ingest(input);
      expect(resumed).toMatchObject({ runId: first.runId, status: 'completed', issues: 0 });
      expect(
        requests.filter((request) => request.api.endsWith('_vip') && !request.params.period),
      ).toEqual([{ api: 'income_vip', params: { report_type: '1', limit: 5000, offset: 0 } }]);
      expect((await database.financialIncomeStatement.findFirstOrThrow()).endDate).toBe('19881231');
      expect(
        await database.ingestionBatch.count({
          where: { runId: first.runId, dataset: 'financial-periods', scope: 'income|1' },
        }),
      ).toBe(2);
    }),
  60_000,
);

it(
  'rolls the period list back with its receipt and restores the original run after a publication failure',
  async () =>
    withSyncDatabase(async (database) => {
      await emptySelections(database);
      await database.$executeRawUnsafe(
        `CREATE TRIGGER refuse_catalog_receipt BEFORE UPDATE ON "IngestionBatch" WHEN NEW.dataset='financial-periods' AND NEW.scope='income|1' AND NEW.status='succeeded' BEGIN SELECT RAISE(ABORT, 'controlled catalog receipt failure'); END`,
      );
      const input = {
        targetDate: '19910104',
        clock: () => ingestionTime,
        onLog: () => {},
        source: ingestionSource({ incomeAvailable: () => true }),
      };
      const first = await ingest(input);
      expect(first.status).toBe('failed');
      const snapshot = runPlanSchema.parse(
        (await database.ingestionRun.findUniqueOrThrow({ where: { id: first.runId } }))
          .scopeSnapshot,
      );
      expect(snapshot.financialPeriods).not.toHaveProperty('income|1');
      expect(await database.financialIncomeStatement.count()).toBe(0);
      await database.$executeRawUnsafe('DROP TRIGGER refuse_catalog_receipt');
      expect(await ingest(input)).toMatchObject({
        runId: first.runId,
        status: 'completed',
        issues: 0,
      });
      expect(await database.financialIncomeStatement.count()).toBe(1);
      expect(
        await database.ingestionBatch.count({
          where: {
            runId: first.runId,
            dataset: 'financial-periods',
            scope: 'income|1',
            status: 'interrupted',
          },
        }),
      ).toBe(1);
    }),
  60_000,
);

it(
  'upgrades an unfinished legacy run without turning per-security receipts into whole-market coverage',
  async () =>
    withSyncDatabase(async (database) => {
      await emptySelections(database);
      await database.ingestionRun.create({
        data: {
          id: '00000000000000000000000001',
          targetDate: '19910104',
          trigger: 'manual',
          status: 'interrupted',
          startedAt: ingestionTime,
          scopeSnapshot: { etfs: [], indices: [], datasets: ['financial-statements'] },
        },
      });
      await database.ingestionBatch.create({
        data: {
          id: 'legacy-security-receipt',
          runId: '00000000000000000000000001',
          dataset: 'financial-statements',
          scope: 'income|1|600000.SH',
          period: 'all',
          api: 'income_vip',
          request: {},
          status: 'succeeded',
          responseComplete: true,
        },
      });
      const result = await ingest({
        targetDate: '19910104',
        clock: () => ingestionTime,
        onLog: () => {},
        source: ingestionSource({ incomeAvailable: () => true }),
      });
      expect(result).toMatchObject({ runId: '00000000000000000000000001', status: 'completed' });
      expect(
        await database.ingestionBatch.findUnique({ where: { id: 'legacy-security-receipt' } }),
      ).not.toBeNull();
      expect(
        await database.ingestionBatch.findFirst({
          where: {
            runId: result.runId,
            dataset: 'financial-statements',
            scope: 'income|1',
            period: '19901231',
          },
        }),
      ).toMatchObject({ status: 'succeeded' });
    }),
  60_000,
);
