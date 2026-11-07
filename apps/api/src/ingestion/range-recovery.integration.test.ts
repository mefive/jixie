import { expect, it } from 'vitest';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { emptySelections, ingestionTime } from '../../tests/ingestion-source.js';
import { ingest, jsonValue } from './ingest.js';
import { runPlanSchema, type IngestionUnit } from './schema.js';

it(
  'rolls a split receipt and child plan back together, then resumes the same run',
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
      await database.$executeRawUnsafe(
        `CREATE TRIGGER refuse_split_plan BEFORE UPDATE ON "IngestionRun" WHEN NEW.scopeSnapshot LIKE '%ann_range/19880101/19880102%' BEGIN SELECT RAISE(ABORT, 'controlled child-plan failure'); END`,
      );
      const input = {
        targetDate: '19910104',
        clock: () => ingestionTime,
        onLog: () => {},
        source: {
          call: async (_api: string, params: Record<string, unknown> = {}) =>
            params.start_date === '19880101' && params.end_date === '19880104'
              ? Array.from({ length: 5000 }, () => ({ ann_date: '19880101' }))
              : [],
        },
      };
      const failed = await ingest(input);
      expect(failed).toMatchObject({ runId, status: 'failed' });
      const unchanged = await database.ingestionRun.findUniqueOrThrow({ where: { id: runId } });
      expect(runPlanSchema.parse(unchanged.scopeSnapshot).plan?.units).toEqual([unit]);
      expect(await database.ingestionBatch.findMany({ where: { runId } })).toMatchObject([
        { status: 'running', responseComplete: false, acceptedCount: 0 },
      ]);
      expect(await database.financialIncomeStatement.count()).toBe(0);

      await database.$executeRawUnsafe('DROP TRIGGER refuse_split_plan');
      const recovered = await ingest(input);
      expect(recovered).toMatchObject({
        runId,
        status: 'completed',
        succeeded: 2,
        failed: 0,
        issues: 0,
      });
      const saved = await database.ingestionRun.findUniqueOrThrow({ where: { id: runId } });
      expect(runPlanSchema.parse(saved.scopeSnapshot).plan?.units).toMatchObject([
        { startDate: '19880101', endDate: '19880102' },
        { startDate: '19880103', endDate: '19880104' },
      ]);
      const attempts = await database.ingestionBatch.findMany({ where: { runId } });
      expect(attempts.filter(({ status }) => status === 'split')).toHaveLength(1);
      expect(attempts.filter(({ status }) => status === 'interrupted')).toHaveLength(1);
      expect(attempts.filter(({ status }) => status === 'succeeded')).toHaveLength(2);
    }),
  60_000,
);
