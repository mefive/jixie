import { createHash } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { synchronizeData } from './sync.js';
import type { PlannedPartition, SelectWindowInput } from './partitions.js';
import { DATASET_POLICIES } from '#market/synchronization/policies.js';
import { datasetInputReadiness } from '#market/synchronization/readiness.js';
import { calendarDay } from '#market/synchronization/date.js';
import { STOCK_CODE_CHANGES } from '#market/instruments/stock-identity.js';

const planning = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock('./partitions.js', async (original) => ({
  ...(await original<typeof import('./partitions.js')>()),
  selectSyncWindow: planning.select,
  SYNC_LIMITS: { partitions: 2, requests: 600, milliseconds: 30 * 60_000 },
}));
const date = '20260915';
const startedAt = new Date('2026-09-16T10:00:00Z');
const partition: PlannedPartition = {
  id: createHash('sha256')
    .update(JSON.stringify(['index-prices', '000300.SH', '20260101', date]))
    .digest('hex'),
  dataset: 'index-prices',
  scope: '000300.SH',
  startDate: '20260101',
  endDate: date,
  policyVersion: 'sync-v1',
  history: false,
};
beforeEach(() => {
  planning.select.mockReset().mockResolvedValue(null);
});

it.each([true, false])(
  'R12/A10 publishes current policy only after complete acceptance: success=%s',
  async (success) =>
    withSyncDatabase(async (database) => {
      await database.stockCodeChange.createMany({ data: [...STOCK_CODE_CHANGES] });
      await database.marketDownloadList.createMany({
        data: [
          { assetType: 'etf', codes: [] },
          { assetType: 'index', codes: ['000300.SH'] },
        ],
      });
      await database.tradeCal.createMany({
        data: Array.from({ length: 258 }, (_, index) => ({
          exchange: 'SSE',
          calDate: calendarDay(partition.startDate, index),
          isOpen: index === 257 ? 1 : 0,
        })),
      });
      const { history: _history, ...storedPartition } = partition;
      await database.datasetSyncPartition.createMany({
        data: [
          { ...storedPartition, status: 'complete', policyVersion: 'retired-policy' },
          {
            id: 'old-history',
            dataset: 'index-prices',
            scope: '000300.SH',
            startDate: '19900101',
            endDate: '20251231',
            status: 'complete',
            policyVersion: 'sync-v1',
          },
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
        data: { dataset: partition.dataset, scope: partition.scope },
      });
      planning.select.mockImplementation(async (input: SelectWindowInput) =>
        input.policy.dataset === partition.dataset && !input.attempted.has(partition.id)
          ? partition
          : null,
      );
      expect((await datasetInputReadiness([partition])).ready).toBe(false);
      const input = {
        targetDate: date,
        startedAt,
        clock: () => startedAt,
        onLog: () => {},
        providers: {
          source: {
            call: async () => {
              if (!success) {
                throw new Error('Controlled provider failure');
              }
              return [{ ts_code: partition.scope, trade_date: date, close: 100 }];
            },
          },
        },
      };
      const result = await synchronizeData(input);
      const firstRevision = (
        await database.marketDataState.findUniqueOrThrow({ where: { key: 'global' } })
      ).revision;
      expect(firstRevision).toBe(success ? 1 : 0);
      await synchronizeData(input);
      expect(
        (await database.marketDataState.findUniqueOrThrow({ where: { key: 'global' } })).revision,
      ).toBe(firstRevision);

      const stored = await database.datasetSyncPartition.findUniqueOrThrow({
        where: { id: partition.id },
      });
      expect(stored.policyVersion).toBe(success ? 'sync-v1' : 'retired-policy');
      expect(stored.status).toBe(success ? 'complete' : 'error');
      expect(stored.lastAttemptAt).toEqual(startedAt);
      expect((await datasetInputReadiness([partition])).ready).toBe(success);
      if (!success) {
        expect(result.status).toBe('error');
      }
      const { selectSyncWindow } =
        await vi.importActual<typeof import('./partitions.js')>('./partitions.js');
      const policy = DATASET_POLICIES.find((entry) => entry.dataset === partition.dataset)!;
      const next = await selectSyncWindow({
        policy,
        targetDate: date,
        startedAt,
        history: false,
        attempted: new Set(),
        deadline: Date.now() + 30_000,
      });
      expect(next?.id ?? null).toBe(success ? null : partition.id);
      const due = await selectSyncWindow({
        policy,
        targetDate: date,
        startedAt: new Date(startedAt.getTime() + 86400_001),
        history: false,
        attempted: new Set(),
        deadline: Date.now() + 30_000,
      });
      expect(due?.id).toBe(partition.id);
    }),
  30_000,
);

it(
  'stops at the actual window limit and resumes the saved dataset after references on restart',
  async () =>
    withSyncDatabase(async (database) => {
      await database.stockCodeChange.createMany({ data: [...STOCK_CODE_CHANGES] });
      await database.marketDownloadList.createMany({
        data: [
          { assetType: 'etf', codes: [] },
          { assetType: 'index', codes: ['000300.SH'] },
        ],
      });
      await database.dataSyncRun.create({
        data: {
          id: 'interrupted',
          targetDate: date,
          status: 'running',
          stage: 'index-prices',
          startedAt: new Date(0),
          summary: { resumeDataset: 'index-prices' },
        },
      });
      const calls: string[] = [];
      const windows = ['20240101', '20250101', '20260101'].map(
        (startDate, index): PlannedPartition => ({
          ...partition,
          id: `bounded-${index}`,
          startDate,
          endDate: `${startDate.slice(0, 4)}1231`,
        }),
      );
      planning.select.mockImplementation(async (input: SelectWindowInput) => {
        calls.push(input.policy.dataset);
        return input.policy.dataset === partition.dataset
          ? (windows.find((window) => !input.attempted.has(window.id)) ?? null)
          : null;
      });
      let requests = 0;
      const input = {
        targetDate: date,
        startedAt,
        clock: () => startedAt,
        onLog: () => {},
        providers: {
          source: {
            call: async () => {
              requests++;
              throw new Error('Controlled failure');
            },
          },
        },
      };
      const first = await synchronizeData(input);
      expect(first.partitions).toBe(2);
      expect(requests).toBe(2);
      expect(first.gaps.some((gap) => gap.includes('Finite run budget'))).toBe(true);
      expect(
        (await database.datasetSyncPartition.findMany()).map((window) => window.id).sort(),
      ).toEqual(['bounded-0', 'bounded-1']);
      expect(
        (await database.dataSyncRun.findUniqueOrThrow({ where: { id: first.runId } })).summary,
      ).toMatchObject({ resumeDataset: 'index-valuations' });
      expect(
        (await database.dataSyncRun.findUniqueOrThrow({ where: { id: 'interrupted' } })).status,
      ).toBe('interrupted');
      calls.length = 0;

      await synchronizeData({ ...input, startedAt: new Date(startedAt.getTime() + 1) });
      expect(calls.slice(0, 3)).toEqual(['calendar', 'stock-master', 'etf-master']);
      expect(calls[3]).toBe('index-valuations');
      expect(await database.dataSyncRun.count()).toBe(2);
      expect(await database.dataSyncRun.findUnique({ where: { id: first.runId } })).not.toBeNull();
    }),
  30_000,
);

it(
  'revokes overlapping completed qualification on a failed recheck without deleting valid prices',
  async () =>
    withSyncDatabase(async (database) => {
      await database.stockCodeChange.createMany({ data: [...STOCK_CODE_CHANGES] });
      await database.marketDownloadList.createMany({
        data: [
          { assetType: 'etf', codes: [] },
          { assetType: 'index', codes: ['000300.SH'] },
        ],
      });
      await database.datasetSyncPartition.create({
        data: {
          id: 'overlapping-proof',
          dataset: partition.dataset,
          scope: partition.scope,
          startDate: '19900101',
          endDate: '20261231',
          status: 'complete',
          policyVersion: partition.policyVersion,
        },
      });
      await database.indexDaily.create({
        data: { tsCode: partition.scope, tradeDate: date, close: 100 },
      });
      planning.select.mockImplementation(async (input: SelectWindowInput) =>
        input.policy.dataset === partition.dataset && !input.attempted.has(partition.id)
          ? partition
          : null,
      );
      expect((await datasetInputReadiness([partition])).ready).toBe(true);

      await synchronizeData({
        targetDate: date,
        startedAt,
        clock: () => startedAt,
        onLog: () => {},
        providers: {
          source: {
            call: async () => {
              throw new Error('Controlled failure');
            },
          },
        },
      });
      expect((await datasetInputReadiness([partition])).ready).toBe(false);
      expect(await database.indexDaily.findMany()).toMatchObject([{ tradeDate: date, close: 100 }]);
      expect(
        (
          await database.datasetSyncPartition.findUniqueOrThrow({
            where: { id: 'overlapping-proof' },
          })
        ).status,
      ).toBe('partial');
      expect(
        (await database.marketDataState.findUniqueOrThrow({ where: { key: 'global' } })).revision,
      ).toBe(1);
    }),
  30_000,
);

it(
  'keeps the saved business dataset when reference acquisition exhausts the run',
  async () =>
    withSyncDatabase(async (database) => {
      await database.stockCodeChange.createMany({ data: [...STOCK_CODE_CHANGES] });
      await database.marketDownloadList.createMany({
        data: [
          { assetType: 'etf', codes: [] },
          { assetType: 'index', codes: [] },
        ],
      });
      await database.dataSyncRun.create({
        data: {
          id: 'prior-business',
          targetDate: date,
          startedAt: new Date(0),
          status: 'complete',
          stage: 'finished',
          summary: { resumeDataset: 'index-prices' },
        },
      });
      planning.select.mockImplementation(async (input: SelectWindowInput) => {
        if (input.policy.dataset !== 'calendar') {
          return null;
        }
        const scope = input.attempted.has('reference-SSE') ? 'SZSE' : 'SSE';
        return input.attempted.has(`reference-${scope}`)
          ? null
          : { ...partition, dataset: 'calendar', scope, id: `reference-${scope}` };
      });

      const result = await synchronizeData({
        targetDate: date,
        startedAt,
        clock: () => startedAt,
        onLog: () => {},
        providers: {
          source: {
            call: async () => {
              throw new Error('Controlled reference failure');
            },
          },
        },
      });
      expect(result.partitions).toBe(2);
      expect(
        (await database.dataSyncRun.findUniqueOrThrow({ where: { id: result.runId } })).summary,
      ).toMatchObject({ resumeDataset: 'index-prices' });
    }),
  30_000,
);
