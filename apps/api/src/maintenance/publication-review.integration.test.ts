import { createHash } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { proveRange } from '../../tests/market-contract-fixtures.js';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { fetchMarketSource } from '#market/providers/source-fetch.js';
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
  history: false,
};
beforeEach(() => {
  planning.select.mockReset().mockResolvedValue(null);
});

it('keeps historical and target gap dates distinct in the run summary', async () =>
  withSyncDatabase(async () => {
    const windows = ['20150105', date].map((session) => ({
      ...partition,
      id: `gap-${session}`,
      startDate: session,
      endDate: session,
    }));
    planning.select.mockImplementation(async (input: SelectWindowInput) =>
      input.policy.dataset === 'index-prices'
        ? (windows.find((window) => !input.attempted.has(window.id)) ?? null)
        : null,
    );

    const result = await synchronizeData({
      targetDate: date,
      startedAt,
      clock: () => startedAt,
      onLog: () => {},
      providers: { source: { call: async () => [] } },
    });
    expect(result.gaps).toEqual(
      expect.arrayContaining([
        expect.stringContaining('index-prices/000300.SH 20150105..20150105 (historical):'),
        expect.stringContaining(`index-prices/000300.SH ${date}..${date} (target):`),
      ]),
    );
  }));

it.each([true, false])(
  'R12/A10 restores eligibility only after complete acceptance: success=%s',
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
          { ...storedPartition, status: 'superseded' },
          {
            id: 'old-history',
            dataset: 'index-prices',
            scope: '000300.SH',
            startDate: '19900101',
            endDate: '20251231',
            status: 'complete',
          },
          {
            id: 'calendar',
            dataset: 'calendar',
            scope: 'SSE',
            startDate: partition.startDate,
            endDate: date,
            status: 'complete',
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
              return [
                {
                  ts_code: partition.scope,
                  trade_date: date,
                  open: 100,
                  high: 100,
                  low: 100,
                  close: 100,
                },
              ];
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
  'stops on cancellation and resumes the saved dataset after references on restart',
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
      const controller = new AbortController();
      const input = {
        targetDate: date,
        startedAt,
        clock: () => startedAt,
        onLog: () => {},
        providers: {
          source: {
            call: async () => {
              requests++;
              if (requests === 2) {
                controller.abort();
              }
              throw new Error('Controlled failure');
            },
          },
        },
      };
      const first = await synchronizeData({ ...input, signal: controller.signal });
      expect(first.partitions).toBe(2);
      expect(requests).toBe(2);
      expect(first.gaps.some((gap) => gap.includes('Synchronization cancelled'))).toBe(true);
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
      await proveRange(database, {
        dataset: 'calendar',
        scope: 'SSE',
        startDate: partition.startDate,
        endDate: partition.endDate,
      });
      await database.tradeCal.create({ data: { exchange: 'SSE', calDate: date, isOpen: 1 } });
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
  'keeps the saved business dataset when reference acquisition is cancelled',
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

      const controller = new AbortController();
      let requests = 0;
      const result = await synchronizeData({
        signal: controller.signal,
        targetDate: date,
        startedAt,
        clock: () => startedAt,
        onLog: () => {},
        providers: {
          source: {
            call: async () => {
              requests++;
              if (requests === 2) {
                controller.abort();
              }
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

it(
  'attempts every target window once beyond the former window, request and time caps',
  async () =>
    withSyncDatabase(async (database) => {
      await database.marketDownloadList.createMany({
        data: [
          { assetType: 'etf', codes: [] },
          { assetType: 'index', codes: ['000300.SH'] },
        ],
      });
      const windows = Array.from(
        { length: 241 },
        (_, index): PlannedPartition => ({
          ...partition,
          id: `uncapped-${index}`,
          startDate: calendarDay('20250101', index),
          endDate: calendarDay('20250101', index),
        }),
      );
      planning.select.mockImplementation(async (input: SelectWindowInput) =>
        input.policy.dataset === partition.dataset
          ? (windows.find((window) => !input.attempted.has(window.id)) ?? null)
          : null,
      );
      let requests = 0;
      const now = Date.now();
      const wallClock = vi.spyOn(Date, 'now');
      const fetcher: typeof fetch = async (_url, options) => {
        requests++;
        expect(options?.signal?.aborted).toBe(false);
        return new Response('ok');
      };

      try {
        const result = await synchronizeData({
          targetDate: date,
          startedAt,
          clock: () => startedAt,
          onLog: () => {},
          providers: {
            source: {
              call: async () => {
                wallClock.mockReturnValue(now + 31 * 60_000);
                for (let attempt = 0; attempt < 3; attempt++) {
                  await fetchMarketSource(fetcher, 'https://fixture.invalid');
                }
                throw new Error('Controlled unavailable window');
              },
            },
          },
        });

        expect(result.partitions).toBe(241);
        expect(requests).toBe(723);
        expect(await database.datasetSyncPartition.count()).toBe(241);
        expect(result.errors).not.toEqual([]);
        expect(result.gaps.some((gap) => gap.includes('budget exhausted'))).toBe(false);
      } finally {
        wallClock.mockRestore();
      }
    }),
  120_000,
);
