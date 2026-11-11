import { expect, it } from 'vitest';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { emptySelections, ingestionSource, ingestionTime } from '../../tests/ingestion-source.js';
import { DIVIDEND_SOURCE_FIELDS } from '#market/fundamentals/dividend-identity.js';
import { ingest } from './ingest.js';
import { acceptCandidate, ingestCandidate, inspectCandidate, retryCandidate } from './replica.js';
import { withCandidate } from './replica-files.js';
import { readRunIssueState } from './issue-state.js';

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

it.each(['股东大会通过', '股东提议'])(
  'retries a legacy non-implementation partial in the same candidate: %s',
  async (div_proc) =>
    withSyncDatabase(async (main) => {
      await emptySelections(main);
      const fallback = ingestionSource();
      const proposal = { ...cash, div_proc, ex_date: null };
      const conflict = { ...proposal, base_share: 101 };
      const rows = [proposal, conflict, cash];
      const source = {
        call: async (api: string, params?: Record<string, unknown>, fields?: string) =>
          api === 'dividend' ? rows : fallback.call(api, params, fields),
      };
      const first = await ingestCandidate(
        {
          targetDate: '19910104',
          clock: () => ingestionTime,
          source,
          onLog: () => {},
        },
        true,
      );
      const previous = await withCandidate(first.runId, async (candidate) => {
        const batch = await candidate.ingestionBatch.findFirstOrThrow({
          where: { runId: first.runId, dataset: 'dividends' },
        });
        const partial = await candidate.ingestionBatch.update({
          where: { id: batch.id },
          data: {
            status: 'partial',
            receivedCount: 3,
            acceptedCount: 1,
            filteredCount: 0,
            rejectedCount: 2,
          },
        });
        const issue = await candidate.ingestionIssue.create({
          data: {
            id: 'legacy-proposal-conflict',
            runId: first.runId,
            batchId: batch.id,
            category: 'record',
            reasonCode: 'conflicting_business_key',
            message: 'Legacy proposal base conflict',
            payload: [proposal, conflict],
          },
        });
        await candidate.ingestionRun.update({
          where: { id: first.runId },
          data: { status: 'completed_with_issues' },
        });

        return {
          partial,
          issue,
          implementation: await candidate.dividend.findFirstOrThrow(),
          otherBatches: await candidate.ingestionBatch.findMany({
            where: { runId: first.runId, dataset: { not: 'dividends' } },
            orderBy: { id: 'asc' },
          }),
        };
      });
      await main.ingestionRun.update({
        where: { id: first.runId },
        data: { status: 'completed_with_issues', replicaPhase: 'awaiting_repair' },
      });
      const calls: string[] = [];
      const resumed = await retryCandidate(first.runId, {
        clock: () => new Date(ingestionTime.getTime() + 1000),
        onLog: () => {},
        source: {
          call: async (api, params, fields) => {
            calls.push(api);

            return source.call(api, params, fields);
          },
        },
      });

      expect(resumed).toMatchObject({ runId: first.runId, phase: 'awaiting_publish', pending: 0 });
      expect(calls).toEqual(['dividend']);
      expect(await main.dividend.count()).toBe(0);
      await withCandidate(first.runId, async (candidate) => {
        expect(await candidate.dividend.findFirstOrThrow()).toEqual(previous.implementation);
        expect(
          await candidate.ingestionBatch.findUnique({ where: { id: previous.partial.id } }),
        ).toEqual(previous.partial);
        expect(
          await candidate.ingestionIssue.findUnique({ where: { id: previous.issue.id } }),
        ).toEqual(previous.issue);
        expect(
          await candidate.ingestionBatch.findMany({
            where: { runId: first.runId, dataset: { not: 'dividends' } },
            orderBy: { id: 'asc' },
          }),
        ).toEqual(previous.otherBatches);
        expect(
          await candidate.ingestionBatch.findFirstOrThrow({
            where: { runId: first.runId, dataset: 'dividends' },
            orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
          }),
        ).toMatchObject({
          status: 'succeeded',
          receivedCount: 3,
          acceptedCount: 1,
          filteredCount: 2,
          rejectedCount: 0,
        });
        const state = await candidate.$transaction((transaction) =>
          readRunIssueState(transaction, first.runId),
        );

        expect(state.active).toEqual([]);
        expect(state.historical).toMatchObject([
          { issue: { id: previous.issue.id }, classification: 'superseded_attempt' },
        ]);
      });
    }),
  60_000,
);

it(
  'publishes date batches after retrying incomplete pagination without reloading stock history',
  async () =>
    withSyncDatabase(async (main) => {
      await emptySelections(main);
      const clock = new Date('2000-01-04T08:00:00Z');
      const existing = await main.dividend.create({
        data: {
          id: 'previous-dividend',
          tsCode: '600000.SH',
          endDate: '19981231',
          cashDivTax: 0.1,
        },
      });
      await main.ingestionRun.create({
        data: {
          id: 'published-history',
          trigger: 'manual',
          status: 'completed',
          scopeSnapshot: {},
          targetDate: '20000101',
          startedAt: clock,
          finishedAt: clock,
          batches: {
            create: {
              id: 'published-stock-dividends',
              dataset: 'dividends',
              scope: '600000.SH',
              period: 'all',
              api: 'dividend',
              request: [
                {
                  api: 'dividend',
                  params: { ts_code: '600000.SH' },
                  fields: DIVIDEND_SOURCE_FIELDS,
                },
              ],
              rangeEnd: '20000101',
              status: 'succeeded',
              responseComplete: true,
              startedAt: clock,
            },
          },
        },
      });

      const event = {
        ...cash,
        end_date: '19991231',
        ann_date: '20000102',
        imp_ann_date: '20000102',
        ex_date: '20000103',
        base_date: '19991231',
        record_date: '20000102',
        pay_date: '20000103',
      };
      const abort = new AbortController();
      const fallback = ingestionSource();
      const requests: Record<string, unknown>[] = [];
      const input = {
        targetDate: '20000102',
        clock: () => clock,
        onLog: () => {},
        source: {
          call: async (api: string, params: Record<string, unknown> = {}, fields?: string) => {
            if (api === 'trade_cal') {
              return [];
            }
            if (api !== 'dividend') {
              return fallback.call(api, params, fields);
            }
            requests.push(params);
            expect(fields).toBe(DIVIDEND_SOURCE_FIELDS);
            if (params.imp_ann_date && !abort.signal.aborted) {
              if (params.offset === 0) {
                return Array.from({ length: 2000 }, () => ({ ...event, ex_date: '20000104' }));
              }
              abort.abort();
              throw new Error('Controlled pagination failure');
            }

            return [event];
          },
        },
      };
      const first = await ingestCandidate({ ...input, signal: abort.signal }, true);
      expect(first.phase).toBe('interrupted');
      expect(requests).toEqual([
        { ann_date: '20000102', limit: 2000, offset: 0 },
        { imp_ann_date: '20000102', limit: 2000, offset: 0 },
        { imp_ann_date: '20000102', limit: 2000, offset: 2000 },
      ]);
      expect(await main.dividend.count()).toBe(1);
      await withCandidate(first.runId, async (candidate) => {
        expect(await candidate.dividend.count()).toBe(2);
        expect(await candidate.dividend.count({ where: { exDate: '20000104' } })).toBe(0);
      });

      requests.length = 0;
      const resumed = await ingestCandidate(input, true);
      expect(resumed).toMatchObject({ runId: first.runId, phase: 'awaiting_publish' });
      expect(requests).toEqual([{ imp_ann_date: '20000102', limit: 2000, offset: 0 }]);
      const review = await inspectCandidate(first.runId);
      await acceptCandidate(first.runId, review.candidateVersion!);

      expect(await main.dividend.count()).toBe(2);
      expect(await main.dividend.findUnique({ where: { id: existing.id } })).toEqual(existing);
      expect(await main.dividend.findFirst({ where: { endDate: event.end_date } })).toMatchObject({
        cashDivTax: event.cash_div_tax,
        implementationAnnouncementDate: event.imp_ann_date,
      });
      expect(
        await main.ingestionBatch.count({
          where: { runId: first.runId, dataset: 'dividends', status: 'succeeded' },
        }),
      ).toBe(2);
    }),
  60_000,
);

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
