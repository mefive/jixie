import { expect, it } from 'vitest';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { emptySelections, ingestionSource, ingestionTime } from '../../tests/ingestion-source.js';
import { ingest } from './ingest.js';

it(
  'uses the real planner, completes auxiliaries without price eligibility, and skips completed history',
  async () =>
    withSyncDatabase(async (database) => {
      await emptySelections(database);
      const calls: string[] = [];
      const input = {
        targetDate: '19910104',
        source: ingestionSource({ onCall: (api) => calls.push(api) }),
        clock: () => ingestionTime,
        onLog: () => {},
      };
      const first = await ingest(input);
      expect(first.status).toBe('completed');
      expect(calls).toContain('dividend');
      expect(await database.daily.count()).toBeGreaterThan(0);
      expect(
        await database.ingestionBatch.count({
          where: { runId: first.runId, status: { not: 'succeeded' } },
        }),
      ).toBe(0);
      const revision = (
        await database.marketDataState.findUniqueOrThrow({ where: { key: 'global' } })
      ).revision;
      const rows = await database.daily.count();
      calls.length = 0;
      const second = await ingest(input);
      expect(second.status).toBe('completed');
      expect(calls).not.toContain('daily');
      expect(calls).not.toContain('adj_factor');
      expect(calls).toContain('stock_basic');
      expect(calls).not.toContain('dividend');
      expect(calls.filter((api) => api === 'income_vip')).toHaveLength(3);
      expect(calls).toContain('fina_indicator_vip');
      expect(await database.daily.count()).toBe(rows);
      expect(
        (await database.marketDataState.findUniqueOrThrow({ where: { key: 'global' } })).revision,
      ).toBe(revision);
    }),
  60_000,
);

it(
  'acquires a later disclosure of an old report and preserves its first capture on repeated targets',
  async () =>
    withSyncDatabase(async (database) => {
      await emptySelections(database);
      let available = false;
      const input = {
        targetDate: '19910104',
        source: ingestionSource({
          incomeAvailable: () => available,
          incomeAnnDate: '19910105',
        }),
        clock: () => ingestionTime,
        onLog: () => {},
      };
      await ingest(input);
      expect(await database.financialIncomeStatement.count()).toBe(0);
      available = true;
      await ingest({
        ...input,
        targetDate: '19910105',
        clock: () => new Date('1991-01-06T10:00:00Z'),
      });
      const saved = await database.financialIncomeStatement.findFirstOrThrow();
      await ingest({
        ...input,
        targetDate: '19910105',
        clock: () => new Date('1991-01-07T10:00:00Z'),
      });
      expect(await database.financialIncomeStatement.count()).toBe(1);
      expect((await database.financialIncomeStatement.findFirstOrThrow()).observedAt).toEqual(
        saved.observedAt,
      );
    }),
  60_000,
);

it(
  'does not publish a received first page when the next page fails',
  async () =>
    withSyncDatabase(async (database) => {
      await emptySelections(database);
      const source = ingestionSource({
        prices: (date, offset) => {
          if (offset) {
            throw new Error('Controlled second-page failure');
          }
          return Array.from({ length: 6000 }, () => ({
            ts_code: '600000.SH',
            trade_date: date,
            open: 10,
            high: 11,
            low: 9,
            close: 10,
          }));
        },
      });
      const failed = await ingest({
        targetDate: '19901219',
        source,
        clock: () => ingestionTime,
        onLog: () => {},
      });
      expect(failed.status).toBe('completed_with_issues');
      expect(await database.daily.count()).toBe(0);
      expect(await database.adjFactor.count()).toBe(1);
      expect(
        await database.ingestionIssue.findFirst({
          where: { runId: failed.runId, category: 'request' },
        }),
      ).not.toBeNull();
      await ingest({
        targetDate: '19901219',
        source: ingestionSource(),
        clock: () => ingestionTime,
        onLog: () => {},
      });
      expect(await database.daily.count()).toBe(1);
    }),
  60_000,
);

it(
  'publishes independent valid rows together with the exact rejected source row',
  async () =>
    withSyncDatabase(async (database) => {
      await emptySelections(database);
      await database.stockBasic.create({
        data: {
          tsCode: '600001.SH',
          symbol: '600001',
          name: 'Known identity with invalid source values',
          listDate: '19901219',
          listStatus: 'L',
          exchange: 'SSE',
        },
      });
      const result = await ingest({
        targetDate: '19901219',
        clock: () => ingestionTime,
        onLog: () => {},
        source: ingestionSource({
          prices: (date) => [
            { ts_code: '600000.SH', trade_date: date, open: 10, high: 11, low: 9, close: 10 },
            { ts_code: '600001.SH', trade_date: date, open: 0, high: 11, low: 9, close: 10 },
          ],
        }),
      });
      expect(result.status).toBe('completed_with_issues');
      expect(await database.daily.count()).toBe(1);
      expect(
        await database.ingestionBatch.findFirst({
          where: { runId: result.runId, dataset: 'stock-prices' },
        }),
      ).toMatchObject({
        status: 'partial',
        responseComplete: true,
        receivedCount: 2,
        acceptedCount: 1,
        rejectedCount: 1,
      });
      const issues = await database.ingestionIssue.findMany({ where: { runId: result.runId } });
      expect(issues).toContainEqual(
        expect.objectContaining({
          payload: expect.objectContaining({ ts_code: '600001.SH', open: 0 }),
        }),
      );
    }),
  60_000,
);

it(
  'rolls business rows back when receipt publication fails, then recovers the interrupted batch',
  async () =>
    withSyncDatabase(async (database) => {
      await emptySelections(database);
      await database.$executeRawUnsafe(
        `CREATE TRIGGER refuse_price_receipt BEFORE UPDATE ON "IngestionBatch" WHEN NEW.dataset='stock-prices' AND NEW.status='succeeded' BEGIN SELECT RAISE(ABORT, 'controlled receipt failure'); END`,
      );
      const input = {
        targetDate: '19901219',
        source: ingestionSource(),
        clock: () => ingestionTime,
        onLog: () => {},
      };
      expect((await ingest(input)).status).toBe('failed');
      expect(await database.daily.count()).toBe(0);
      const interrupted = await database.ingestionBatch.findFirstOrThrow({
        where: { dataset: 'stock-prices' },
      });
      expect(interrupted.status).toBe('running');
      await database.$executeRawUnsafe('DROP TRIGGER refuse_price_receipt');
      expect((await ingest(input)).status).toBe('completed');
      expect(
        await database.ingestionBatch.findUniqueOrThrow({ where: { id: interrupted.id } }),
      ).toMatchObject({ status: 'interrupted' });
      expect(await database.daily.count()).toBe(1);
    }),
  60_000,
);

it(
  'resumes after cancellation without discarding previous successful commits',
  async () =>
    withSyncDatabase(async (database) => {
      await emptySelections(database);
      const controller = new AbortController();
      const first = await ingest({
        targetDate: '19901220',
        clock: () => ingestionTime,
        onLog: () => {},
        signal: controller.signal,
        source: ingestionSource({
          onCall: (api) => {
            if (api === 'daily_basic') {
              controller.abort();
            }
          },
        }),
      });
      expect(first.status).toBe('interrupted');
      const saved = await database.daily.findMany();
      expect(saved.length).toBeGreaterThan(0);
      expect(
        (
          await ingest({
            targetDate: '19901220',
            clock: () => ingestionTime,
            onLog: () => {},
            source: ingestionSource(),
          })
        ).status,
      ).toBe('completed');
      expect(await database.daily.findMany()).toEqual(expect.arrayContaining(saved));
    }),
  60_000,
);

it(
  'retains known ETF observations after a complete empty source response',
  async () =>
    withSyncDatabase(async (database) => {
      await database.ingestionSelection.createMany({
        data: [
          { assetType: 'etf', codes: ['510000.SH'] },
          { assetType: 'index', codes: [] },
        ],
      });
      await database.etfDaily.create({
        data: { tsCode: '510000.SH', tradeDate: '19901219', close: 10 },
      });
      await database.etfAdjFactor.create({
        data: { tsCode: '510000.SH', tradeDate: '19901219', adjFactor: 1 },
      });
      const result = await ingest({
        targetDate: '19901219',
        clock: () => ingestionTime,
        source: ingestionSource(),
        onLog: () => {},
      });
      expect(result.status).toBe('completed');
      expect(await database.etfDaily.count()).toBe(1);
      expect(await database.etfAdjFactor.count()).toBe(1);
      expect(
        await database.ingestionBatch.findFirst({
          where: { runId: result.runId, dataset: 'etf-prices' },
        }),
      ).toMatchObject({ status: 'succeeded', receivedCount: 0 });
    }),
  60_000,
);

it(
  'bootstraps pre-IPO reports by announcement windows and reuses completed dates',
  async () =>
    withSyncDatabase(async (database) => {
      await emptySelections(database);
      const requests: Record<string, unknown>[] = [];
      const source = ingestionSource({
        incomeAvailable: () => true,
        incomePeriod: '19881231',
        onCall: (api, params) => {
          if (api === 'income_vip') {
            requests.push(params);
          }
        },
      });
      const input = { targetDate: '19910104', clock: () => ingestionTime, source, onLog: () => {} };
      await ingest(input);
      expect((await database.financialIncomeStatement.findFirstOrThrow()).endDate).toBe('19881231');
      expect(requests.some((request) => request.start_date === '19880101')).toBe(true);
      expect(requests.some((request) => request.end_date === '19910105')).toBe(true);
      for (const request of requests) {
        expect(request).not.toHaveProperty('period');
        expect(request).not.toHaveProperty('ts_code');
      }
      requests.length = 0;
      await ingest(input);
      expect(requests).toHaveLength(3);
      expect(requests.every((request) => request.start_date === '19910105')).toBe(true);
      expect(await database.financialIncomeStatement.count()).toBe(1);
    }),
  60_000,
);

it(
  'discovers index history without an invented start parameter and reuses its receipt',
  async () =>
    withSyncDatabase(async (database) => {
      await database.ingestionSelection.createMany({
        data: [
          { assetType: 'etf', codes: [] },
          { assetType: 'index', codes: ['000300.SH'] },
        ],
      });
      const requests: Record<string, unknown>[] = [];
      const source = ingestionSource({
        onCall: (api, params) => {
          if (api === 'index_daily') {
            requests.push(params);
          }
        },
      });
      const input = { targetDate: '19910104', clock: () => ingestionTime, source, onLog: () => {} };
      await ingest(input);
      expect(requests).toHaveLength(1);
      expect(requests[0]).not.toHaveProperty('start_date');
      expect(
        await database.ingestionBatch.findFirst({
          where: { dataset: 'index-prices', scope: '000300.SH', period: 'history' },
        }),
      ).toMatchObject({ sourceStart: '19901219' });
      requests.length = 0;
      await ingest(input);
      expect(requests).toHaveLength(0);
    }),
  60_000,
);

it(
  'does not seal an empty current-session market response before publication',
  async () =>
    withSyncDatabase(async (database) => {
      await emptySelections(database);
      const clock = () => new Date('1990-12-19T10:00:00Z');
      const first = await ingest({
        targetDate: '19901219',
        clock,
        source: ingestionSource({ prices: () => [] }),
        onLog: () => {},
      });
      expect(first.status).toBe('completed_with_issues');
      expect(
        await database.ingestionIssue.findFirst({
          where: { runId: first.runId, reasonCode: 'current_session_not_published' },
        }),
      ).not.toBeNull();
      expect(
        (
          await ingest({
            targetDate: '19901219',
            clock,
            source: ingestionSource(),
            onLog: () => {},
          })
        ).status,
      ).toBe('completed');
      expect(await database.daily.count()).toBe(1);
    }),
  60_000,
);

it(
  'accepts newer dividend bases in one batch while continuing independent market batches',
  async () =>
    withSyncDatabase(async (database) => {
      await emptySelections(database);
      const source = ingestionSource();
      const dividend = {
        ts_code: '600000.SH',
        end_date: '19901231',
        ann_date: '19910326',
        ex_date: null,
        div_proc: '预案',
        cash_div: 0,
        cash_div_tax: 1.07,
        base_date: '19901231',
        base_share: 100,
      };
      const result = await ingest({
        targetDate: '19910104',
        clock: () => ingestionTime,
        onLog: () => {},
        source: {
          call: async (api, params, fields) =>
            api === 'dividend'
              ? [
                  { ...dividend, base_date: '19910409', cash_div_tax: 1.045102, base_share: 102 },
                  dividend,
                ]
              : source.call(api, params, fields),
        },
      });
      expect(result.status).toBe('completed');
      expect(await database.ingestionIssue.count()).toBe(0);
      expect(await database.dividend.findFirstOrThrow()).toMatchObject({
        baseDate: '19910409',
        cashDivTax: 1.045102,
        availabilityQuality: 'latest_only',
      });
      expect(
        await database.ingestionBatch.findFirstOrThrow({
          where: { runId: result.runId, dataset: 'dividends' },
        }),
      ).toMatchObject({
        status: 'succeeded',
        receivedCount: 2,
        acceptedCount: 1,
        filteredCount: 1,
        rejectedCount: 0,
      });
      expect(await database.daily.count()).toBeGreaterThan(0);
    }),
  60_000,
);

it(
  'retries a former partial adjustment batch and completes after filtering absent codes',
  async () =>
    withSyncDatabase(async (database) => {
      await emptySelections(database);
      await database.adjFactor.create({
        data: { tsCode: '600000.SH', tradeDate: '19901219', adjFactor: 1 },
      });
      await database.ingestionRun.create({
        data: {
          id: 'previous-run',
          trigger: 'manual',
          targetDate: '19901219',
          scopeSnapshot: {},
          status: 'completed_with_issues',
          startedAt: new Date('1991-01-04T10:00:00Z'),
        },
      });
      await database.ingestionBatch.create({
        data: {
          id: 'previous-adjustments',
          runId: 'previous-run',
          dataset: 'stock-adjustments',
          scope: 'SSE',
          period: '19901219',
          api: 'adj_factor',
          request: {},
          rangeStart: '19901219',
          rangeEnd: '19901219',
          responseComplete: true,
          status: 'partial',
          startedAt: new Date('1991-01-04T10:00:00Z'),
          rejectedCount: 3,
        },
      });
      await database.ingestionIssue.create({
        data: {
          id: 'previous-issue',
          runId: 'previous-run',
          batchId: 'previous-adjustments',
          category: 'record',
          reasonCode: 'record_not_accepted',
          message: 'Historical unrecognized B-share code',
          payload: { ts_code: '900906.SH' },
        },
      });
      const source = ingestionSource();
      const result = await ingest({
        targetDate: '19901219',
        clock: () => ingestionTime,
        onLog: () => {},
        source: {
          call: async (api, params, fields) => {
            const rows = await source.call(api, params, fields);
            if (api !== 'adj_factor') {
              return rows;
            }

            return [
              ...rows,
              ...['900906.SH', '900930.SH', '900951.SH'].map((ts_code) => ({
                ts_code,
                trade_date: String(params?.trade_date),
                adj_factor: 1,
              })),
            ];
          },
        },
      });

      expect(result.status).toBe('completed');
      expect(result.rejected).toBe(0);
      expect(result.issues).toBe(0);
      expect(result.runId).toBe('previous-run');
      expect(
        await database.ingestionBatch.findFirstOrThrow({
          where: { runId: result.runId, dataset: 'stock-adjustments' },
          orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        }),
      ).toMatchObject({
        status: 'succeeded',
        receivedCount: 4,
        acceptedCount: 1,
        filteredCount: 3,
        rejectedCount: 0,
      });
      expect(await database.adjFactor.count()).toBe(1);
      expect(
        await database.ingestionBatch.findUniqueOrThrow({ where: { id: 'previous-adjustments' } }),
      ).toMatchObject({ status: 'partial' });
      expect(await database.ingestionIssue.count({ where: { runId: 'previous-run' } })).toBe(1);
    }),
  60_000,
);
