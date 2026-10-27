import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { calendarDay } from '#market/synchronization/date.js';
import { qualifyMarketPartition } from '#market/synchronization/qualify.js';
import { acceptMarketPartition } from '#market/synchronization/records.js';
import { prepareStockPartition } from '#market/stocks/sync-partition.js';
import { prepareIndexPartition } from '#market/indices/sync-partition.js';
import { planSyncPartitions } from './partitions.js';

const tradeDate = '20260915';
const fetchedAt = new Date('2026-09-16T10:00:00Z');

async function calendar(
  database: Parameters<Parameters<typeof withSyncDatabase>[0]>[0],
  start: string,
  end: string,
  open: string[],
) {
  const rows = [];
  for (let date = start; date <= end; date = calendarDay(date, 1)) {
    rows.push({ exchange: 'SSE', calDate: date, isOpen: open.includes(date) ? 1 : 0 });
  }
  for (let offset = 0; offset < rows.length; offset += 200) {
    await database.tradeCal.createMany({ data: rows.slice(offset, offset + 200) });
  }
  await database.datasetSyncPartition.create({
    data: {
      id: `calendar-${start}-${end}`,
      dataset: 'calendar',
      scope: 'SSE',
      startDate: start,
      endDate: end,
      status: 'complete',
      policyVersion: 'sync-v1',
    },
  });
}

describe('unified sync review regressions', () => {
  it('R01/A06 replaces a complete atomic snapshot independently while retaining an invalid one', async () =>
    withSyncDatabase(async (database) => {
      await database.indexWeight.createMany({
        data: [
          { indexCode: '000300.SH', conCode: '600000.SH', tradeDate, weight: 80 },
          { indexCode: '000300.SH', conCode: '600001.SH', tradeDate, weight: 20 },
          { indexCode: '000300.SH', conCode: '600000.SH', tradeDate: '20260914', weight: 100 },
        ],
      });
      const partition = {
        dataset: 'index-weights',
        scope: '000300.SH',
        startDate: '20260901',
        endDate: '20260930',
      };
      const response = await qualifyMarketPartition(
        partition,
        await prepareIndexPartition(
          {
            call: async () => [
              {
                index_code: '000300.SH',
                con_code: '000001.SZ',
                trade_date: tradeDate,
                weight: 100,
              },
              {
                index_code: '000300.SH',
                con_code: '000001.SZ',
                trade_date: '20260914',
                weight: 10,
              },
            ],
          },
          partition,
        ),
      );
      expect(response.status).toBe('error');
      await database.$transaction((transaction) =>
        acceptMarketPartition(transaction, response, partition.dataset, fetchedAt),
      );
      expect(await database.indexWeight.findMany({ where: { tradeDate } })).toMatchObject([
        { conCode: '000001.SZ', weight: 100 },
      ]);
      expect(
        await database.indexWeight.findMany({ where: { tradeDate: '20260914' } }),
      ).toMatchObject([{ conCode: '600000.SH', weight: 100 }]);
    }));

  it('R01/A05 merges actual short stock responses without deleting known prices', async () =>
    withSyncDatabase(async (database) => {
      await calendar(database, tradeDate, tradeDate, [tradeDate]);
      await database.stockBasic.createMany({
        data: ['600000.SH', '000001.SZ'].map((tsCode) => ({
          tsCode,
          symbol: tsCode.slice(0, 6),
          name: tsCode,
          listDate: '20100101',
          listStatus: 'L',
        })),
      });
      await database.datasetSyncPartition.createMany({
        data: ['L', 'D', 'P', 'G'].map((scope) => ({
          id: `master-${scope}`,
          dataset: 'stock-master',
          scope,
          startDate: tradeDate,
          endDate: tradeDate,
          status: 'complete',
          policyVersion: 'sync-v1',
        })),
      });
      await database.daily.createMany({
        data: ['600000.SH', '000001.SZ'].map((tsCode) => ({ tsCode, tradeDate, close: 10 })),
      });
      const source = {
        call: async (api: string) =>
          api === 'suspend_d' ? [] : [{ ts_code: '600000.SH', trade_date: tradeDate, close: 11 }],
      };
      const pricePartition = {
        dataset: 'stock-prices',
        scope: 'all',
        startDate: tradeDate,
        endDate: tradeDate,
      };
      const prices = await qualifyMarketPartition(
        pricePartition,
        await prepareStockPartition(source, pricePartition),
      );
      expect(prices.evidence.terminalPage).toBe(true);
      expect(prices.status).toBe('partial');
      expect(prices.tables[0].replacement).toBeUndefined();
      await database.$transaction((transaction) =>
        acceptMarketPartition(transaction, prices, 'stock-prices', fetchedAt),
      );
      expect(await database.daily.findMany({ orderBy: { tsCode: 'asc' } })).toMatchObject([
        { tsCode: '000001.SZ', close: 10 },
        { tsCode: '600000.SH', close: 11 },
      ]);

      await database.datasetSyncPartition.create({
        data: {
          id: 'prices-proof',
          ...pricePartition,
          status: 'complete',
          policyVersion: 'sync-v1',
        },
      });
      const authoritativeSource = {
        call: async (api: string) =>
          api === 'suspend_d'
            ? [
                {
                  ts_code: '000001.SZ',
                  trade_date: tradeDate,
                  suspend_type: 'S',
                  suspend_timing: null,
                },
              ]
            : [{ ts_code: '600000.SH', trade_date: tradeDate, close: 12 }],
      };
      const correction = await qualifyMarketPartition(
        pricePartition,
        await prepareStockPartition(authoritativeSource, pricePartition),
      );
      expect(correction.status).toBe('complete');
      expect(correction.tables[0].replacement?.basis).toContain('suspension');
      const accepted = await database.$transaction((transaction) =>
        acceptMarketPartition(transaction, correction, 'stock-prices', fetchedAt),
      );
      expect(accepted.deleted).toBe(1);
      expect(await database.daily.findMany()).toMatchObject([{ tsCode: '600000.SH', close: 12 }]);
    }));

  it(
    'R02/A02/A04 holds historical cursors across calendar gaps and later plans every historical session',
    async () =>
      withSyncDatabase(async (database) => {
        await calendar(database, '20260101', '20261231', [tradeDate]);
        const input = {
          targetDate: tradeDate,
          startedAt: fetchedAt,
          requirements: { etfCodes: [] },
          budget: 240,
        };
        const first = await planSyncPartitions(input);
        expect(first.partitions).toContainEqual(
          expect.objectContaining({ dataset: 'stock-prices', startDate: tradeDate }),
        );
        expect(
          await database.datasetSyncState.findUniqueOrThrow({
            where: { dataset_scope: { dataset: 'stock-prices', scope: 'all' } },
          }),
        ).toMatchObject({ backfillCursor: '20150101' });

        const expected = Array.from({ length: 11 }, (_, index) => `${2015 + index}0105`);
        await calendar(database, '20150101', '20251231', expected);
        const seen = new Set(first.partitions.map((partition) => partition.id));
        const dates = new Set<string>();
        for (let round = 0; round < 12; round++) {
          const next = await planSyncPartitions({ ...input, excludeIds: seen });
          for (const partition of next.partitions) {
            seen.add(partition.id);
            if (partition.dataset === 'stock-prices') {
              dates.add(partition.startDate);
            }
          }
        }
        expect(expected.every((date) => dates.has(date))).toBe(true);
        expect([...dates].filter((date) => date < '20260101').sort()).toEqual(expected);
      }),
    60_000,
  );
});

it('R09/A06 rejects a canonical identity collision before replacing a constituent snapshot', async () =>
  withSyncDatabase(async (database) => {
    const partition = {
      dataset: 'index-weights',
      scope: '000300.SH',
      startDate: tradeDate,
      endDate: tradeDate,
    };
    const original = { indexCode: partition.scope, conCode: '600000.SH', tradeDate, weight: 100 };
    await database.indexWeight.create({ data: original });
    const response = await qualifyMarketPartition(
      partition,
      await prepareIndexPartition(
        {
          call: async () =>
            ['000022.SZ', '001872.SZ'].map((con_code) => ({
              index_code: partition.scope,
              con_code,
              trade_date: tradeDate,
              weight: 50,
            })),
        },
        partition,
      ),
    );
    expect(response.status).toBe('error');
    expect(response.errors).toContain(
      `Incomplete or invalid constituent snapshot ${partition.scope}/${tradeDate}`,
    );
    await database.$transaction((transaction) =>
      acceptMarketPartition(transaction, response, partition.dataset, fetchedAt),
    );
    expect(await database.indexWeight.findMany()).toEqual([original]);

    const duplicate = { values: { ...original, conCode: '001872.SZ', weight: 50 } };
    const accepted = await database.$transaction((transaction) =>
      acceptMarketPartition(
        transaction,
        {
          tables: [
            {
              table: 'IndexWeight',
              atomic: true,
              records: [duplicate, duplicate],
              replacement: {
                where: { indexCode: partition.scope, tradeDate },
                authoritative: true,
                independent: true,
                basis: 'Controlled atomic snapshot fixture',
              },
            },
          ],
          status: 'complete',
          evidence: {},
          gaps: [],
          errors: [],
          observedDates: [tradeDate],
        },
        partition.dataset,
        fetchedAt,
      ),
    );
    expect(accepted.errors).toHaveLength(1);
    expect(accepted.inserted + accepted.updated + accepted.deleted).toBe(0);
    expect(await database.indexWeight.findMany()).toEqual([original]);
  }));

it(
  'R11/A04 advances recent rechecks across repeated plans, cooldowns and an excluded date',
  async () =>
    withSyncDatabase(async (database) => {
      const startDate = '20260901';
      const dates = Array.from({ length: 15 }, (_, index) => calendarDay(startDate, index));
      await calendar(database, startDate, tradeDate, dates);
      await database.datasetSyncState.create({
        data: {
          dataset: 'stock-prices',
          scope: 'all',
          historyStart: startDate,
          backfillCursor: tradeDate,
          recheckCursor: startDate,
          policyVersion: 'sync-v1',
        },
      });
      const selectedDates = new Set<string>();
      const excluded = new Set<string>();
      for (let round = 0; round < 6; round++) {
        if (round === 1) {
          const date = calendarDay(startDate, 1);
          excluded.add(
            createHash('sha256')
              .update(JSON.stringify(['stock-prices', 'all', date, date]))
              .digest('hex'),
          );
        }

        const plan = await planSyncPartitions({
          targetDate: tradeDate,
          startedAt: fetchedAt,
          requirements: { etfCodes: [] },
          budget: 240,
          excludeIds: excluded,
        });
        for (const partition of plan.partitions) {
          excluded.add(partition.id);
          if (partition.dataset === 'stock-prices' && partition.startDate < tradeDate) {
            selectedDates.add(partition.startDate);
            await database.datasetSyncPartition.update({
              where: { id: partition.id },
              data: {
                status: 'complete',
                nextAttemptAt: new Date('2099-01-01T00:00:00Z'),
              },
            });
          }
        }
        // 每轮保留最早日期的冷却，重新启动的计划也必须继续扫描其他日期。
        // Retain the earliest date's cooldown while restarted planning reaches later dates.
        excluded.clear();
      }
      expect(selectedDates.has(startDate)).toBe(true);
      expect(selectedDates.size).toBeGreaterThanOrEqual(6);
      expect([...selectedDates].some((date) => date > calendarDay(startDate, 3))).toBe(true);
    }),
  30_000,
);
