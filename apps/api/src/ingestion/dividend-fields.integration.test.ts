import { expect, it } from 'vitest';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { emptySelections, ingestionSource, ingestionTime } from '../../tests/ingestion-source.js';
import { DIVIDEND_SOURCE_FIELDS } from '#market/fundamentals/dividend-identity.js';
import { ingest } from './ingest.js';

const cash = {
  ts_code: '600000.SH',
  end_date: '19901231',
  ann_date: '19910103',
  div_proc: '实施',
  ex_date: '19910104',
  record_date: '19910103',
  pay_date: '19910104',
  cash_div: 0.15,
  cash_div_tax: 0.15,
  stk_div: 0,
  stk_bo_rate: null,
  stk_co_rate: null,
  base_date: '19901231',
  base_share: 100,
  imp_ann_date: '19910103',
  div_listdate: null,
};

it(
  'refreshes a successful old-field dividend batch once in the original Run while skipping other successes',
  async () =>
    withSyncDatabase(async (database) => {
      await emptySelections(database);
      const fallback = ingestionSource();
      const input = {
        targetDate: '19910104',
        clock: () => ingestionTime,
        onLog: () => {},
        source: {
          call: async (api: string, params: Record<string, unknown> = {}, fields?: string) =>
            api === 'dividend' ? [cash] : fallback.call(api, params, fields),
        },
      };
      const first = await ingest(input);
      expect(first.status).toBe('completed');
      const before = await database.dividend.findFirstOrThrow();
      const oldBatch = await database.ingestionBatch.findFirstOrThrow({
        where: { runId: first.runId, dataset: 'dividends' },
      });
      await database.ingestionRun.update({
        where: { id: first.runId },
        data: { status: 'interrupted' },
      });
      await database.ingestionBatch.update({
        where: { id: oldBatch.id },
        data: {
          request: [
            {
              api: 'dividend',
              params: { ts_code: '600000.SH' },
              fields:
                'ts_code,end_date,ann_date,ex_date,div_proc,cash_div,cash_div_tax,base_date,base_share',
            },
          ],
        },
      });
      await database.dividend.update({
        where: { id: before.id },
        data: {
          distributionKind: null,
          recordDate: null,
          payDate: null,
          stockDividend: null,
          implementationAnnouncementDate: null,
        },
      });
      const calls: string[] = [];
      const resumed = await ingest({
        ...input,
        source: {
          call: async (api, params, fields) => {
            calls.push(api);
            if (api === 'dividend') {
              expect(fields).toBe(DIVIDEND_SOURCE_FIELDS);
            }
            return input.source.call(api, params, fields);
          },
        },
      });
      expect(resumed).toMatchObject({ runId: first.runId, status: 'completed' });
      expect(calls).toEqual(['dividend']);
      expect(await database.dividend.findFirstOrThrow()).toMatchObject({
        id: before.id,
        observedAt: before.observedAt,
        distributionKind: 'cash',
        recordDate: cash.record_date,
      });
      expect(
        await database.ingestionBatch.count({
          where: { runId: first.runId, dataset: 'dividends' },
        }),
      ).toBe(2);
      await database.ingestionRun.update({
        where: { id: first.runId },
        data: { status: 'interrupted' },
      });
      calls.length = 0;
      await ingest({
        ...input,
        source: {
          call: async (api, params, fields) => {
            calls.push(api);
            return input.source.call(api, params, fields);
          },
        },
      });
      expect(calls).toEqual([]);
      expect(
        await database.ingestionBatch.findUniqueOrThrow({ where: { id: oldBatch.id } }),
      ).toMatchObject({ status: 'succeeded' });
    }),
  60_000,
);

it(
  'rolls dividend changes and the new receipt back together when publication fails',
  async () =>
    withSyncDatabase(async (database) => {
      await emptySelections(database);
      await database.$executeRawUnsafe(
        `CREATE TRIGGER refuse_dividend_receipt BEFORE UPDATE ON "IngestionBatch" WHEN NEW.dataset='dividends' AND NEW.status='succeeded' BEGIN SELECT RAISE(ABORT, 'controlled dividend publication failure'); END`,
      );
      const fallback = ingestionSource();
      const input = {
        targetDate: '19910104',
        clock: () => ingestionTime,
        onLog: () => {},
        source: {
          call: async (api: string, params: Record<string, unknown> = {}, fields?: string) =>
            api === 'dividend' ? [cash] : fallback.call(api, params, fields),
        },
      };
      const result = await ingest(input);
      expect(result.status).toBe('failed');
      expect(await database.dividend.count()).toBe(0);
      expect(
        await database.ingestionBatch.count({
          where: { runId: result.runId, dataset: 'dividends', status: 'succeeded' },
        }),
      ).toBe(0);
      await database.$executeRawUnsafe('DROP TRIGGER refuse_dividend_receipt');
      expect(await ingest(input)).toMatchObject({ runId: result.runId, status: 'completed' });
      expect(await database.dividend.count()).toBe(1);
    }),
  60_000,
);
