import { createHash } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { synchronizeData } from './sync.js';
import type { PlannedPartition } from './partitions.js';
import type { SyncProviders } from '#market/synchronization/prepare.js';
import { datasetInputReadiness } from '#market/synchronization/readiness.js';
import { calendarDay } from '#market/synchronization/date.js';

const planning = vi.hoisted(() => ({ plan: vi.fn() }));
vi.mock('./partitions.js', async (original) => ({
  ...(await original<typeof import('./partitions.js')>()),
  planSyncPartitions: planning.plan,
}));

const date = '20260915';
const startedAt = new Date('2026-09-16T10:00:00Z');
const providers = (call: SyncProviders['source']['call']): SyncProviders => ({
  source: { call },
  treasury: { fetchRange: async () => [] },
  credit: { fetchRange: async () => [] },
  cpi: { loadSeries: async () => [] },
});
const partition: PlannedPartition = {
  id: createHash('sha256')
    .update(JSON.stringify(['index-prices', '000300.SH', '20260826', date]))
    .digest('hex'),
  dataset: 'index-prices',
  scope: '000300.SH',
  startDate: '20260826',
  endDate: date,
  policyVersion: 'sync-v1',
};

beforeEach(() => {
  planning.plan.mockReset().mockResolvedValue({ partitions: [], gaps: [] });
});

it.each([true, false])(
  'R12/A10 publishes the new policy only with accepted complete evidence: success=%s',
  async (success) =>
    withSyncDatabase(async (database) => {
      await database.tradeCal.createMany({
        data: Array.from({ length: 21 }, (_, index) => ({
          exchange: 'SSE',
          calDate: calendarDay(partition.startDate, index),
          isOpen: index === 20 ? 1 : 0,
        })),
      });
      await database.datasetSyncPartition.createMany({
        data: [
          { ...partition, status: 'complete', policyVersion: 'retired-policy' },
          {
            id: 'calendar',
            dataset: 'calendar',
            scope: 'SSE',
            startDate: partition.startDate,
            endDate: date,
            status: 'complete',
            policyVersion: 'sync-v1',
          },
        ],
      });
      await database.datasetSyncState.create({
        data: {
          dataset: partition.dataset,
          scope: partition.scope,
          historyStart: partition.startDate,
          backfillCursor: date,
          policyVersion: 'retired-policy',
        },
      });
      planning.plan.mockImplementation(async (input: { excludeIds: Set<string> }) => ({
        partitions: input.excludeIds.has(partition.id) ? [] : [partition],
        gaps: [],
      }));
      expect((await datasetInputReadiness([partition])).ready).toBe(false);
      const result = await synchronizeData({
        targetDate: date,
        startedAt,
        requirements: { etfCodes: [] },
        onLog: () => {},
        providers: providers(async () => {
          if (!success) {
            throw new Error('Controlled provider failure');
          }
          return [{ ts_code: partition.scope, trade_date: date, close: 100 }];
        }),
      });
      const stored = await database.datasetSyncPartition.findUniqueOrThrow({
        where: { id: partition.id },
      });
      const state = await database.datasetSyncState.findUniqueOrThrow({
        where: { dataset_scope: { dataset: partition.dataset, scope: partition.scope } },
      });
      expect(stored.policyVersion).toBe(success ? 'sync-v1' : 'retired-policy');
      expect(stored.status).toBe(success ? 'complete' : 'error');
      expect(state.verifiedThrough).toBe(success ? date : null);
      expect((await datasetInputReadiness([partition])).ready).toBe(success);
      expect(stored.nextAttemptAt!.getTime()).toBeGreaterThan(startedAt.getTime());
      if (!success) {
        expect(result.status).toBe('error');
      }
      const { planSyncPartitions } =
        await vi.importActual<typeof import('./partitions.js')>('./partitions.js');
      const next = await planSyncPartitions({
        targetDate: date,
        startedAt,
        requirements: { etfCodes: [] },
      });
      if (success) {
        expect(next.partitions.some((candidate) => candidate.id === partition.id)).toBe(false);
      }
      const due = await planSyncPartitions({
        targetDate: date,
        startedAt: new Date(stored.nextAttemptAt!.getTime() + 1),
        requirements: { etfCodes: [] },
        budget: 1000,
      });
      expect(due.partitions.some((candidate) => candidate.id === partition.id)).toBe(true);
    }),
  30_000,
);
