import { expect, it } from 'vitest';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { emptySelections, ingestionTime } from '../../tests/ingestion-source.js';
import { ingest, jsonValue } from './ingest.js';
import { runPlanSchema, type IngestionUnit } from './schema.js';

it(
  'retries a single frozen window from page zero after a terminal-page failure',
  async () =>
    withSyncDatabase(async (database) => {
      await emptySelections(database);
      const runId = 'range-plan-rollback';
      const unit: IngestionUnit = {
        dataset: 'financial-statements',
        scope: 'income|1',
        api: 'income_vip',
        period: 'ann_range/19880101/19880104',
        startDate: '19880101',
        endDate: '19880104',
        announcementField: 'ann_date',
        announcementRange: true,
        adaptiveRange: true,
        catalogThrough: '19910104',
        refresh: true,
      };
      await database.ingestionRun.create({
        data: {
          id: runId,
          targetDate: '19910104',
          trigger: 'manual',
          status: 'interrupted',
          startedAt: ingestionTime,
          scopeSnapshot: jsonValue({
            version: 2,
            referenceUnits: [],
            selectionUnits: [],
            plan: {
              units: [unit],
              blocked: [],
              statementCodes: [],
              statementStrategy: 'announcement_range',
            },
          }),
        },
      });
      let failPage = true;
      const offsets: unknown[] = [];
      const input = {
        targetDate: '19910104',
        clock: () => ingestionTime,
        onLog: () => {},
        source: {
          call: async (_api: string, params: Record<string, unknown> = {}) => {
            offsets.push(params.offset);
            if (params.offset === 0) {
              return Array.from({ length: 5000 }, () => ({
                ts_code: '999999.SH',
                ann_date: '19880101',
              }));
            }
            if (failPage) {
              throw new Error('Controlled last-page failure');
            }
            return [];
          },
        },
      };
      const failed = await ingest(input);
      expect(failed).toMatchObject({ runId, status: 'completed_with_issues' });
      const unchanged = await database.ingestionRun.findUniqueOrThrow({ where: { id: runId } });
      expect(runPlanSchema.parse(unchanged.scopeSnapshot).plan?.units).toEqual([unit]);
      expect(await database.ingestionBatch.findMany({ where: { runId } })).toMatchObject([
        { status: 'failed', responseComplete: false, acceptedCount: 0 },
      ]);
      expect(await database.financialIncomeStatement.count()).toBe(0);

      failPage = false;
      const recovered = await ingest(input);
      expect(recovered).toMatchObject({
        runId,
        status: 'completed',
        succeeded: 1,
        failed: 0,
        issues: 0,
      });
      const saved = await database.ingestionRun.findUniqueOrThrow({ where: { id: runId } });
      expect(runPlanSchema.parse(saved.scopeSnapshot).plan?.units).toEqual([unit]);
      expect(offsets).toEqual([0, 5000, 0, 5000]);
      const attempts = await database.ingestionBatch.findMany({
        where: { runId },
        orderBy: { id: 'asc' },
      });
      expect(attempts.map((batch) => batch.status)).toEqual(['failed', 'succeeded']);
    }),
  60_000,
);
