import { expect, it } from 'vitest';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { exportIngestionIssues } from './issue-export.js';
import { readIssueOverview } from './issue-overview.js';

it.each([
  { name: 'pre-listing success', target: '20250101', complete: true, rejected: 0, covered: true },
  { name: 'same-target success', target: '20181231', complete: true, rejected: 0, covered: true },
  { name: 'older target', target: '20171231', complete: true, rejected: 0, covered: false },
  { name: 'listing day', target: '20260828', complete: true, rejected: 0, covered: false },
  { name: 'after listing', target: '20260901', complete: true, rejected: 0, covered: false },
  { name: 'incomplete response', target: '20250101', complete: false, rejected: 0, covered: false },
  { name: 'rejected records', target: '20250101', complete: true, rejected: 1, covered: false },
])(
  'checks $name before archiving a legacy ETF issue behind a newer partial',
  async ({ target, complete, rejected, covered }) =>
    withSyncDatabase(async (database) => {
      await database.marketDataState.create({ data: { key: 'global', revision: 1 } });

      for (const [id, targetDate, date] of [
        ['old', '20181231', '2026-11-01'],
        ['success', target, '2026-11-03'],
        ['partial', '20261111', '2026-11-12'],
      ]) {
        await database.ingestionRun.create({
          data: {
            id,
            trigger: 'manual',
            targetDate,
            status: id === 'success' ? 'completed' : 'completed_with_issues',
            startedAt: new Date(date),
            finishedAt: new Date(date),
            scopeSnapshot: {},
          },
        });
        await database.ingestionBatch.create({
          data: {
            id,
            runId: id,
            dataset: 'etf-master',
            scope: 'all',
            period: 'snapshot',
            api: 'etf_basic',
            status: id === 'success' ? 'succeeded' : 'partial',
            request: [{ api: 'etf_basic', params: {} }],
            responseComplete: id === 'success' ? complete : true,
            rejectedCount: id === 'success' ? rejected : 1,
            startedAt: new Date(date),
            finishedAt: new Date(date),
          },
        });
      }

      await database.ingestionIssue.create({
        data: {
          id: 'legacy-etf',
          runId: 'old',
          batchId: 'old',
          category: 'record',
          severity: 'error',
          reasonCode: 'record_not_accepted',
          message: 'Missing sameDayTurnover',
          payload: { ts_code: '158008.OF', list_date: '20260828' },
        },
      });
      const original = await database.ingestionIssue.findUniqueOrThrow({
        where: { id: 'legacy-etf' },
      });
      const bundle = await exportIngestionIssues({
        runId: 'old',
        code: { commit: 'test', sourceDirty: false },
      });
      const overview = await database.$transaction((transaction) =>
        readIssueOverview(transaction, 'old', true),
      );

      if (covered) {
        expect(bundle.items).toEqual([]);
        expect(bundle.historicalIssues).toContainEqual(
          expect.objectContaining({
            id: 'legacy-etf',
            classification: 'covered_by_later_run',
            coverage: {
              reason: 'etf_listing_after_target',
              receiptIds: ['success'],
              runIds: ['success'],
            },
          }),
        );
        expect(overview.health.coveredHistorical).toBe(1);
        expect(overview.health.unknownValidity).toBe(0);
      } else {
        expect(bundle.items).toMatchObject([
          { issue: { id: 'legacy-etf' }, handling: { status: 'review' } },
        ]);
        expect(overview.health.coveredHistorical).toBe(0);
        expect(overview.health.unknownValidity).toBe(1);
      }

      expect(await database.ingestionIssue.findUnique({ where: { id: original.id } })).toEqual(
        original,
      );
      expect(await database.ingestionIssueResolution.count()).toBe(0);
      expect((await database.marketDataState.findFirstOrThrow()).revision).toBe(1);
    }),
  60_000,
);
