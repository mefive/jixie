import { expect, it } from 'vitest';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { emptySelections, ingestionSource, ingestionTime } from '../../tests/ingestion-source.js';
import { acceptCandidate, ingestCandidate, inspectCandidate, retryCandidate } from './replica.js';
import { withCandidate } from './replica-files.js';
import { statementReceiptMatchesBatch } from '#market/fundamentals/statement-requests.js';
import { financialStatementSourceFields } from '#market/fundamentals/source-contract.js';
import { jsonValue } from './ingest.js';
import { runPlanSchema } from './schema.js';

it(
  'resumes a split window after a child failure and publishes one PIT version from both filters',
  async () =>
    withSyncDatabase(async (main) => {
      await emptySelections(main);
      const initial = await ingestCandidate(
        {
          targetDate: '19910104',
          source: ingestionSource({ incomeAvailable: () => true }),
          clock: () => ingestionTime,
          onLog: () => {},
        },
        true,
      );
      const before = await inspectCandidate(initial.runId);
      await acceptCandidate(initial.runId, before.candidateVersion!);
      expect(await main.financialIncomeStatement.count()).toBe(1);
      const original = await main.financialIncomeStatement.findFirstOrThrow();

      const abort = new AbortController();
      let failChild = true;
      const calls: Array<{ api: string; params: Record<string, unknown> }> = [];
      const fallback = ingestionSource({
        incomeAvailable: () => true,
        incomeAnnDate: '19910105',
        incomeActualAnnDate: '19910106',
      });
      const input = {
        targetDate: '19910106',
        clock: () => new Date('1991-01-07T10:00:00Z'),
        onLog: () => {},
        source: {
          call: async (api: string, params: Record<string, unknown> = {}, fields?: string) => {
            calls.push({ api, params });
            if (api === 'income_vip' && params.report_type === '1') {
              if (params.start_date === '19910107' && failChild) {
                abort.abort();
                throw new Error('Controlled statement child-window failure');
              }
              if (params.start_date === '19910105' && params.end_date === '19910107') {
                const rows = await fallback.call(api, params, fields);

                return Array.from({ length: 5000 }, () => rows[0]);
              }
            }

            const rows = await fallback.call(api, params, fields);
            if (api === 'income_vip' && params.f_ann_date === '19910106' && rows.length) {
              return [...rows, { ...rows[0], ann_date: '19901228', end_date: '19891231' }];
            }

            return rows;
          },
        },
      };
      const interrupted = await ingestCandidate({ ...input, signal: abort.signal }, true);
      expect(interrupted.phase).toBe('interrupted');
      expect(await main.financialIncomeStatement.count()).toBe(1);
      await withCandidate(interrupted.runId, async (candidate) => {
        expect(await candidate.financialIncomeStatement.count()).toBe(1);
      });

      failChild = false;
      calls.length = 0;
      const resumed = await ingestCandidate(input, true);
      expect(resumed).toMatchObject({ runId: interrupted.runId, phase: 'awaiting_publish' });
      expect(
        calls
          .filter(({ api }) => ['income_vip', 'balancesheet_vip', 'cashflow_vip'].includes(api))
          .every(({ params }) => !params.period && Boolean(params.start_date || params.f_ann_date)),
      ).toBe(true);
      await withCandidate(interrupted.runId, async (candidate) => {
        const receipt = await candidate.ingestionBatch.findFirstOrThrow({
          where: {
            runId: interrupted.runId,
            scope: 'income|1',
            period: 'ann_range/19910105/19910107',
            status: 'succeeded',
          },
        });
        expect(statementReceiptMatchesBatch(receipt)).toBe(true);
        expect(receipt.request).toMatchObject([
          { params: { start_date: '19910105', end_date: '19910107' } },
          { params: { start_date: '19910105', end_date: '19910106' } },
          { params: { start_date: '19910107', end_date: '19910107' } },
        ]);
        const rows = await candidate.financialIncomeStatement.findMany();
        expect(rows).toHaveLength(3);
        expect(
          rows.find(({ fAnnDate, endDate }) => fAnnDate === '19910106' && endDate === '19901231'),
        ).toMatchObject({
          endDate: '19901231',
          annDate: '19910105',
          fAnnDate: '19910106',
          announcementDate: '19910106',
          availableDate: '19910107',
        });
        expect(rows.find(({ endDate }) => endDate === '19891231')).toMatchObject({
          annDate: '19901228',
          fAnnDate: '19910106',
          availableDate: '19910107',
        });
        expect(rows.find(({ id }) => id === original.id)).toEqual(original);
      });
      expect(await main.financialIncomeStatement.count()).toBe(1);
      const reviewed = await inspectCandidate(interrupted.runId);
      await acceptCandidate(interrupted.runId, reviewed.candidateVersion!);
      expect(await main.financialIncomeStatement.count()).toBe(3);
    }),
  60_000,
);

it(
  'upgrades an interrupted candidate in place and retries diagnosed legacy statements',
  async () =>
    withSyncDatabase(async (main) => {
      await emptySelections(main);
      const stop = new AbortController();
      const clock = () => ingestionTime;
      const interrupted = await ingestCandidate(
        {
          targetDate: '19910104',
          source: ingestionSource({
            onCall: (api) => {
              if (api === 'income_vip') {
                stop.abort();
              }
            },
          }),
          signal: stop.signal,
          clock,
          onLog: () => {},
        },
        true,
      );
      expect(interrupted.phase).toBe('interrupted');
      const { runId } = interrupted;
      const quarter = {
        dataset: 'financial-statements',
        api: 'income_vip',
        scope: 'income|1',
        period: '19901231',
        startDate: '19901231',
        endDate: '19901231',
        refresh: true,
        catalogThrough: '19910104',
      };
      const diagnosed = {
        ...quarter,
        period: 'f_ann_date/19910104',
        startDate: '19910104',
        endDate: '19910104',
        announcementField: 'f_ann_date' as const,
      };
      const supersededPlan = {
        ...quarter,
        period: '19900930',
        startDate: '19900930',
        endDate: '19900930',
      };
      await withCandidate(runId, async (candidate) => {
        const saved = await candidate.ingestionRun.findUniqueOrThrow({ where: { id: runId } });
        const snapshot = runPlanSchema.parse(saved.scopeSnapshot);
        const otherUnits = snapshot.plan!.units.filter(
          ({ dataset }) => dataset !== quarter.dataset,
        );
        await candidate.ingestionRun.update({
          where: { id: runId },
          data: {
            scopeSnapshot: jsonValue({
              ...snapshot,
              plan: {
                units: [...otherUnits, quarter, diagnosed, supersededPlan],
                blocked: [],
                statementCodes: snapshot.plan!.statementCodes,
              },
            }),
          },
        });
        await candidate.ingestionBatch.createMany({
          data: [
            {
              id: 'legacy-quarter',
              runId,
              dataset: quarter.dataset,
              api: quarter.api,
              scope: quarter.scope,
              period: quarter.period,
              rangeStart: quarter.startDate,
              rangeEnd: quarter.endDate,
              status: 'succeeded',
              responseComplete: true,
              startedAt: ingestionTime,
              finishedAt: ingestionTime,
              request: [
                {
                  api: quarter.api,
                  params: { period: quarter.period, report_type: '1' },
                  fields: financialStatementSourceFields('income').join(','),
                },
              ],
            },
            {
              id: 'legacy-failed',
              runId,
              dataset: diagnosed.dataset,
              api: diagnosed.api,
              scope: diagnosed.scope,
              period: diagnosed.period,
              rangeStart: diagnosed.startDate,
              rangeEnd: diagnosed.endDate,
              status: 'failed',
              startedAt: ingestionTime,
              finishedAt: ingestionTime,
              request: [],
            },
          ],
        });
        await candidate.ingestionIssue.create({
          data: {
            id: 'legacy-issue',
            runId,
            batchId: 'legacy-failed',
            category: 'request',
            reasonCode: 'source_request_failed',
            message: 'Legacy fixture failure',
          },
        });
      });

      const calls: Record<string, unknown>[] = [];
      const result = await retryCandidate(runId, {
        source: ingestionSource({
          incomeAvailable: () => true,
          onCall: (api, params) => {
            if (api === 'income_vip') {
              calls.push(params);
            }
          },
        }),
        clock: () => new Date('1991-01-06T10:00:00Z'),
        onLog: () => {},
      });
      expect(result).toMatchObject({ runId, phase: 'awaiting_publish' });
      expect(calls.some(({ start_date }) => Boolean(start_date))).toBe(true);
      expect(calls.some(({ f_ann_date }) => f_ann_date === '19910104')).toBe(true);
      expect(calls.every(({ period }) => !period)).toBe(true);
      await withCandidate(runId, async (candidate) => {
        const saved = await candidate.ingestionRun.findUniqueOrThrow({ where: { id: runId } });
        const { plan } = runPlanSchema.parse(saved.scopeSnapshot);
        expect(plan?.statementStrategy).toBe('announcement_range');
        expect(
          plan?.units.some(
            ({ dataset, scope, period }) =>
              dataset === supersededPlan.dataset &&
              scope === supersededPlan.scope &&
              period === supersededPlan.period,
          ),
        ).toBe(false);
        expect(
          await candidate.ingestionBatch.findUnique({ where: { id: 'legacy-quarter' } }),
        ).toMatchObject({ status: 'succeeded', finishedAt: ingestionTime });
        expect(
          await candidate.ingestionIssue.findUnique({ where: { id: 'legacy-issue' } }),
        ).not.toBeNull();
      });
      expect(await main.financialIncomeStatement.count()).toBe(0);
    }),
  60_000,
);
