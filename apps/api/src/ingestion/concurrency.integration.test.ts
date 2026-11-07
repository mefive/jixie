import { expect, it } from 'vitest';
import { ulid } from 'ulid';
import type { Prisma } from '#infra/database/prisma.js';
import { sourceRequestSignal } from '#market/providers/source-fetch.js';
import { MarketSyncBudgetError } from '#market/errors.js';
import { sourceExecution, sourceRequests } from '#market/synchronization/execution.js';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { emptySelections, ingestionTime, ingestionSource } from '../../tests/ingestion-source.js';
import { ingest, jsonValue } from './ingest.js';
import { runPlanSchema, type IngestionUnit } from './schema.js';

async function seed(database: Prisma, units: IngestionUnit[]) {
  await emptySelections(database);
  await database.stockBasic.create({
    data: {
      tsCode: '600000.SH',
      symbol: '600000',
      name: 'Fixture',
      exchange: 'SSE',
      listDate: '19901219',
      listStatus: 'L',
    },
  });
  await database.tradeCal.createMany({
    data: [
      '19901225',
      '19901226',
      '19901227',
      '19901228',
      '19901231',
      '19910102',
      '19910103',
      '19910104',
      '19910107',
    ].map((date) => ({ exchange: 'SSE', calDate: date, isOpen: 1 })),
  });
  const runId = ulid();
  await database.ingestionRun.create({
    data: {
      id: runId,
      trigger: 'manual',
      targetDate: '19910104',
      status: 'interrupted',
      startedAt: ingestionTime,
      scopeSnapshot: jsonValue({
        version: 2,
        referenceUnits: [],
        selectionUnits: [],
        plan: {
          units,
          blocked: [],
          statementCodes: ['600000.SH'],
          statementStrategy: 'announcement_range',
        },
      }),
    },
  });

  return runId;
}
const prices = (date: string): IngestionUnit => ({
  dataset: 'stock-prices',
  scope: 'SSE',
  api: 'daily',
  period: date,
  startDate: date,
  endDate: date,
  refresh: false,
});
const bar = (date: string) => ({
  ts_code: '600000.SH',
  trade_date: date,
  open: 10,
  close: 10,
  high: 11,
  low: 9,
});

it(
  'downloads out of order, prepares in plan order and calls the source only once per batch',
  async () =>
    withSyncDatabase(async (database) => {
      const runId = await seed(database, [prices('19910102'), prices('19910103')]);
      let releaseFirst!: () => void;
      const firstMayFinish = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const completed: string[] = [];
      const calls: string[] = [];
      const result = await ingest({
        targetDate: '19910104',
        concurrency: 2,
        clock: () => ingestionTime,
        onLog: () => {},
        source: {
          call: async (_api, params = {}) => {
            const date = String(params.trade_date);
            calls.push(date);
            if (date === '19910102') {
              await firstMayFinish;
            } else {
              expect(await database.daily.count()).toBe(0);
              releaseFirst();
            }
            completed.push(date);

            return [bar(date)];
          },
        },
      });
      expect(result).toMatchObject({ runId, status: 'completed', succeeded: 2 });
      expect(completed).toEqual(['19910103', '19910102']);
      expect(calls).toHaveLength(2);
      const receipts = await database.ingestionBatch.findMany({
        where: { runId },
        orderBy: { finishedAt: 'asc' },
      });
      expect(receipts.every((row) => row.status === 'succeeded')).toBe(true);
      expect(receipts.map((row) => sourceExecution(row.request)?.httpRequests)).toEqual([1, 1]);
      expect(await database.daily.count()).toBe(2);
    }),
  60_000,
);

it('preserves the same dividend event and newer base under concurrency 1, 2 and 4', async () => {
  const outputs = [];
  for (const concurrency of [1, 2, 4]) {
    outputs.push(
      await withSyncDatabase(async (database) => {
        const history: IngestionUnit = {
          dataset: 'dividends',
          scope: '600000.SH',
          api: 'dividend',
          period: 'all',
          startDate: '19880101',
          endDate: '19910104',
          fullHistory: true,
          refresh: true,
        };
        const dated: IngestionUnit = {
          ...history,
          scope: 'ann_date',
          period: '19910103',
          fullHistory: false,
          startDate: '19910103',
          endDate: '19910103',
          catalogThrough: '19910104',
        };
        await seed(database, [history, dated]);
        const result = await ingest({
          targetDate: '19910104',
          concurrency,
          clock: () => ingestionTime,
          onLog: () => {},
          source: {
            call: async (_api, params = {}) => [
              {
                ts_code: '600000.SH',
                end_date: '19901231',
                ann_date: '19910103',
                imp_ann_date: '19910103',
                div_proc: '实施',
                ex_date: '19910104',
                record_date: '19910103',
                pay_date: '19910104',
                cash_div: params.ts_code ? 0.1 : 0.2,
                cash_div_tax: params.ts_code ? 0.1 : 0.2,
                stk_div: 0,
                stk_bo_rate: null,
                stk_co_rate: null,
                base_date: params.ts_code ? '19901231' : '19910101',
                base_share: 100,
                div_listdate: null,
              },
            ],
          },
        });
        expect(result.status).toBe('completed');
        const rows = await database.dividend.findMany({
          select: { id: true, cashDivTax: true, baseDate: true, observedAt: true },
        });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ cashDivTax: 0.2, baseDate: '19910101' });

        return rows;
      }),
    );
  }
  expect(outputs[1]).toEqual(outputs[0]);
  expect(outputs[2]).toEqual(outputs[0]);
}, 60_000);

it(
  'cancels in-flight and buffered work without partial admission, then skips committed work on resume',
  async () =>
    withSyncDatabase(async (database) => {
      const runId = await seed(database, ['19910102', '19910103', '19910104'].map(prices));
      const controller = new AbortController();
      const interrupted = await ingest({
        targetDate: '19910104',
        concurrency: 2,
        signal: controller.signal,
        clock: () => ingestionTime,
        onLog: () => {},
        source: {
          call: async (_api, params = {}) => {
            const date = String(params.trade_date);
            if (date === '19910103') {
              const signal = sourceRequestSignal()!;
              await new Promise<void>((_resolve, reject) => {
                const cancel = () => reject(new MarketSyncBudgetError());
                signal.addEventListener('abort', cancel, { once: true });
                if (signal.aborted) {
                  cancel();
                }
              });
            }
            if (date === '19910104') {
              expect(await database.daily.count()).toBe(1);
              controller.abort();
            }

            return [bar(date)];
          },
        },
      });
      expect(interrupted).toMatchObject({
        status: 'interrupted',
        succeeded: 1,
        issues: 0,
        failed: 0,
      });
      expect(await database.daily.count()).toBe(1);
      const attempts = await database.ingestionBatch.findMany({ where: { runId } });
      expect(attempts.filter(({ status }) => status === 'running')).toEqual([]);
      expect(attempts.filter(({ status }) => status === 'interrupted')).toHaveLength(2);
      const calls: string[] = [];
      const resumed = await ingest({
        targetDate: '19910104',
        concurrency: 2,
        clock: () => ingestionTime,
        onLog: () => {},
        source: {
          call: async (_api, params = {}) => {
            const date = String(params.trade_date);
            calls.push(date);
            return [bar(date)];
          },
        },
      });
      expect(resumed).toMatchObject({ runId, status: 'completed', succeeded: 3, issues: 0 });
      expect(calls.sort()).toEqual(['19910103', '19910104']);
    }),
  60_000,
);

it(
  'keeps a split parent and its children atomic while the future window is full and responses spill',
  async () =>
    withSyncDatabase(async (database) => {
      const root: IngestionUnit = {
        dataset: 'financial-statements',
        scope: 'income|1',
        api: 'income_vip',
        period: 'ann_range/19880101/19880104',
        startDate: '19880101',
        endDate: '19880104',
        catalogThrough: '19910104',
        announcementRange: true,
        announcementField: 'ann_date',
        adaptiveRange: true,
        refresh: true,
      };
      const days = [
        '19901225',
        '19901226',
        '19901227',
        '19901228',
        '19901231',
        '19910102',
        '19910103',
      ];
      const runId = await seed(database, [root, ...days.map(prices)]);
      const calls: string[] = [];
      const result = await ingest({
        targetDate: '19910104',
        concurrency: 4,
        bufferBytes: 1,
        clock: () => ingestionTime,
        onLog: () => {},
        source: {
          call: async (api, params = {}) => {
            calls.push(JSON.stringify([api, params]));
            if (api === 'income_vip') {
              return params.start_date === '19880101' && params.end_date === '19880104'
                ? Array.from({ length: 5000 }, () => ({ ann_date: '19880101' }))
                : [];
            }

            return [bar(String(params.trade_date))];
          },
        },
      });
      expect(result).toMatchObject({ status: 'completed', succeeded: 9, issues: 0 });
      expect(await database.daily.count()).toBe(7);
      expect(calls).toHaveLength(10);
      const saved = await database.ingestionRun.findUniqueOrThrow({ where: { id: runId } });
      const units = runPlanSchema.parse(saved.scopeSnapshot).plan!.units;
      expect(units.filter(({ dataset }) => dataset === root.dataset)).toMatchObject([
        { endDate: '19880102' },
        { startDate: '19880103' },
      ]);
      const split = await database.ingestionBatch.findFirstOrThrow({
        where: { runId, status: 'split' },
      });
      expect(sourceRequests(split.request)).toHaveLength(1);
    }),
  60_000,
);

it('preserves financial version fingerprints and same-date revision quality under concurrency 1, 2 and 4', async () => {
  const outputs = [];
  for (const concurrency of [1, 2, 4]) {
    outputs.push(
      await withSyncDatabase(async (database) => {
        const announcement: IngestionUnit = {
          dataset: 'financial-statements',
          scope: 'income|1',
          api: 'income_vip',
          period: 'ann_range/19880101/19910103',
          startDate: '19880101',
          endDate: '19910103',
          announcementField: 'ann_date',
          announcementRange: true,
          adaptiveRange: true,
          catalogThrough: '19910104',
          refresh: true,
        };
        const actual: IngestionUnit = {
          ...announcement,
          period: 'f_ann_date/19910103',
          startDate: '19910103',
          announcementField: 'f_ann_date',
        };
        delete actual.announcementRange;
        delete actual.adaptiveRange;
        await seed(database, [announcement, actual]);
        const source = ingestionSource({ incomeAvailable: () => true, incomeAnnDate: '19910103' });
        const result = await ingest({
          targetDate: '19910104',
          concurrency,
          clock: () => ingestionTime,
          onLog: () => {},
          source: {
            call: async (api, params = {}, fields) => {
              const rows = await source.call(api, params, fields);

              return params.f_ann_date
                ? rows.map((row) => ({ ...row, update_flag: '1', revenue: 101 }))
                : rows;
            },
          },
        });
        expect(result).toMatchObject({ status: 'completed', issues: 0 });
        const versions = await database.financialIncomeStatement.findMany({
          select: {
            sourceRowFingerprint: true,
            revenue: true,
            availabilityQuality: true,
            annDate: true,
            fAnnDate: true,
            announcementDate: true,
            availableDate: true,
            observedAt: true,
          },
          orderBy: { sourceRowFingerprint: 'asc' },
        });
        expect(versions).toHaveLength(2);
        expect(new Set(versions.map((row) => row.availabilityQuality))).toEqual(
          new Set(['conservative', 'reconstructed']),
        );

        return versions;
      }),
    );
  }
  expect(outputs[1]).toEqual(outputs[0]);
  expect(outputs[2]).toEqual(outputs[0]);
}, 60_000);
