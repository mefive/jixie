import { beforeEach, expect, it, vi } from 'vitest';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { calendarDay } from '#market/synchronization/date.js';
import { STOCK_CODE_CHANGES } from '#market/instruments/stock-identity.js';
import { currentDerivedRows } from '#market/state/current.js';
import { MARKET_AUDIT_VERSION, MARKET_CALCULATION_VERSION } from '#market/state/eligibility.js';
import { withMaintenanceLock } from '#infra/coordination/market-access.js';
import type { Prisma } from '#infra/database/prisma.js';
import type { PlannedPartition } from './partitions.js';
import { synchronizeData } from './sync.js';
import { refreshMarketCalculations } from './calculations.js';

const control = vi.hoisted(() => ({
  partition: null as PlannedPartition | null,
  deferCalculations: false,
  preparationFailure: false,
}));
vi.mock('./partitions.js', async (original) => ({
  ...(await original<typeof import('./partitions.js')>()),
  planSyncPartitions: async (input: { excludeIds: ReadonlySet<string> }) => ({
    partitions:
      control.partition && !input.excludeIds.has(control.partition.id) ? [control.partition] : [],
    gaps: [],
  }),
}));
vi.mock('./calculations.js', async (original) => {
  const actual = await original<typeof import('./calculations.js')>();
  return {
    ...actual,
    refreshMarketCalculations: async (
      input: Parameters<typeof actual.refreshMarketCalculations>[0],
    ) =>
      control.deferCalculations
        ? { ready: 0, ...(await actual.readMarketCalculationBacklog()) }
        : actual.refreshMarketCalculations(input),
  };
});
vi.mock('#market/synchronization/prepare.js', async (original) => {
  const actual = await original<typeof import('#market/synchronization/prepare.js')>();
  return {
    ...actual,
    prepareMarketPartition: async (...input: Parameters<typeof actual.prepareMarketPartition>) => {
      if (control.preparationFailure) {
        throw new Error('Controlled preparation exception');
      }
      return actual.prepareMarketPartition(...input);
    },
  };
});

const outputDate = '20260115';
const indexCodes = ['000300.SH', '000905.SH'];

/**
 * 跨年真实行情及覆盖证明；年初已有合格输出，之后只切换上一年证明状态。
 *
 * Seed real cross-year prices and proof with qualified January outputs; change only prior-year proof.
 */
async function seed(database: Prisma) {
  await database.stockCodeChange.createMany({ data: [...STOCK_CODE_CHANGES] });

  const calendar = [];
  for (let date = '20250101'; date <= '20260430'; date = calendarDay(date, 1)) {
    const weekday = new Date(
      `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T00:00:00Z`,
    ).getUTCDay();
    calendar.push({
      exchange: 'SSE',
      calDate: date,
      isOpen: date >= '20251001' && weekday > 0 && weekday < 6 ? 1 : 0,
    });
  }
  const sessions = calendar.filter((date) => date.isOpen === 1).map((date) => date.calDate);
  const following = sessions.filter((date) => date > '20251231');
  await database.tradeCal.createMany({ data: calendar });
  await database.daily.createMany({
    data: sessions.map((tradeDate, index) => ({
      tsCode: '600000.SH',
      tradeDate,
      close: 10 + index / 100,
      pctChg: 1,
      amount: 100,
    })),
  });
  await database.adjFactor.createMany({
    data: sessions.map((tradeDate) => ({ tsCode: '600000.SH', tradeDate, adjFactor: 1 })),
  });
  await database.dailyBasic.createMany({
    data: sessions.map((tradeDate) => ({
      tsCode: '600000.SH',
      tradeDate,
      circMv: 100,
      turnoverRate: 1,
      peTtm: 15,
      pb: 1,
    })),
  });
  await database.stkLimit.createMany({
    data: sessions.map((tradeDate) => ({
      tsCode: '600000.SH',
      tradeDate,
      upLimit: 20,
      downLimit: 5,
    })),
  });
  await database.indexDaily.createMany({
    data: indexCodes.flatMap((tsCode) =>
      sessions.map((tradeDate, index) => ({ tsCode, tradeDate, close: 100 + index })),
    ),
  });
  await database.indexWeight.createMany({
    data: indexCodes.map((indexCode) => ({
      indexCode,
      conCode: '600000.SH',
      tradeDate: '20251001',
      weight: 100,
    })),
  });
  await database.datasetSyncPartition.createMany({
    data: [
      ...['2025', '2026'].map((year) => ({
        id: `calendar-${year}`,
        dataset: 'calendar',
        scope: 'SSE',
        startDate: `${year}0101`,
        endDate: year === '2025' ? '20251231' : '20260430',
      })),
      ...indexCodes.flatMap((scope) => [
        {
          id: `prices-${scope}`,
          dataset: 'index-prices',
          scope,
          startDate: '20250101',
          endDate: '20251231',
        },
        {
          id: `new-prices-${scope}`,
          dataset: 'index-prices',
          scope,
          startDate: '20260101',
          endDate: '20260430',
        },
        {
          id: `members-${scope}`,
          dataset: 'index-weights',
          scope,
          startDate: '20251001',
          endDate: '20251001',
        },
      ]),
      ...['stock-prices', 'stock-adjustments', 'stock-valuations', 'stock-limits'].map(
        (dataset) => ({
          id: dataset,
          dataset,
          scope: 'all',
          startDate: '20251001',
          endDate: '20260430',
        }),
      ),
    ].map((partition) => ({ ...partition, status: 'complete', policyVersion: 'sync-v1' })),
  });
  await database.marketDataState.create({ data: { key: 'global', revision: 1 } });
  await database.marketCalculationState.create({
    data: {
      kind: 'market-state',
      scope: 'all',
      date: outputDate,
      status: 'stale',
      dirtyScopes: ['all'],
      calculationVersion: MARKET_CALCULATION_VERSION,
      auditVersion: MARKET_AUDIT_VERSION,
    },
  });
  await withMaintenanceLock(() => refreshMarketCalculations({ targetDate: outputDate, limit: 1 }));
  expect(await database.marketCalculationState.findFirstOrThrow()).toMatchObject({
    status: 'ready',
    generation: 1,
    readyGeneration: 1,
  });

  const boundaryDates = [following[19], following[20], following[58], following[59]];
  await database.marketCalculationState.createMany({
    data: boundaryDates.map((date) => ({
      kind: 'market-state',
      scope: 'all',
      date,
      status: 'ready',
      generation: 1,
      readyGeneration: 1,
      dirtyScopes: [],
      inputVersions: { qualifiedScopes: ['market', ...indexCodes.map((code) => `index:${code}`)] },
      calculationVersion: MARKET_CALCULATION_VERSION,
      auditVersion: MARKET_AUDIT_VERSION,
    })),
  });

  return { calendar, following };
}

beforeEach(() => {
  control.partition = null;
  control.deferCalculations = false;
  control.preparationFailure = false;
});

it.each([
  ['index-prices', 'source-error'],
  ['index-prices', 'preparation-error'],
  ['calendar', 'source-error'],
  ['calendar', 'preparation-error'],
] as const)(
  'R15/A08/A10 propagates cross-year %s proof changes through %s without changing raw values',
  async (dataset, failure) =>
    withSyncDatabase(async (database) => {
      const fixture = await seed(database);
      const scope = dataset === 'calendar' ? 'SSE' : indexCodes[0];
      const id = dataset === 'calendar' ? 'calendar-2025' : `prices-${scope}`;
      control.partition = {
        id,
        dataset,
        scope,
        startDate: '20250101',
        endDate: '20251231',
        policyVersion: 'sync-v1',
      };
      await database.datasetSyncState.create({
        data: {
          dataset,
          scope,
          historyStart: '20250101',
          backfillCursor: '20260101',
          policyVersion: 'sync-v1',
        },
      });
      const prices = await database.indexDaily.findMany({
        orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }],
      });
      const calendar = await database.tradeCal.findMany({ orderBy: { calDate: 'asc' } });
      const original = await database.indexIndicator.findMany({
        where: { tradeDate: outputDate },
        orderBy: { indexCode: 'asc' },
      });
      expect(original[0].return20).toBeGreaterThan(0);
      let restored = false;
      control.deferCalculations = true;
      control.preparationFailure = failure === 'preparation-error';
      const input = {
        targetDate: '20251231',
        startedAt: new Date('2026-01-02T10:00:00Z'),
        requirements: { etfCodes: [] },
        onLog: () => {},
        providers: {
          source: {
            call: async () => {
              if (!restored) {
                throw new Error('Controlled source failure');
              }
              return dataset === 'calendar'
                ? fixture.calendar
                    .filter((row) => row.calDate <= '20251231')
                    .map((row) => ({ exchange: 'SSE', cal_date: row.calDate, is_open: row.isOpen }))
                : prices
                    .filter((row) => row.tsCode === scope && row.tradeDate <= '20251231')
                    .map((row) => ({
                      ts_code: row.tsCode,
                      trade_date: row.tradeDate,
                      close: row.close,
                    }));
            },
          },
          treasury: { fetchRange: async () => [] },
          credit: { fetchRange: async () => [] },
          cpi: { loadSeries: async () => [] },
        },
      };

      const failed = await synchronizeData(input);
      expect(failed.status).toBe('error');
      expect(failed.accepted).toEqual({ inserted: 0, updated: 0, deleted: 0, rejected: 0 });
      expect(
        await database.datasetSyncPartition.findUniqueOrThrow({ where: { id } }),
      ).toMatchObject({ status: 'error' });
      const changed = await database.marketCalculationState.findUniqueOrThrow({
        where: { kind_scope_date: { kind: 'market-state', scope: 'all', date: outputDate } },
      });
      expect(changed).toMatchObject({
        status: 'stale',
        generation: 2,
        readyGeneration: 1,
        dirtyScopes: dataset === 'calendar' ? ['all'] : [`index:${scope}`],
      });
      const visible = await currentDerivedRows(original);
      expect(visible[0].return20).toBeNull();
      expect(visible[1].return20).toBe(dataset === 'calendar' ? null : original[1].return20);
      const market = await currentDerivedRows(
        await database.marketIndicator.findMany({ where: { tradeDate: outputDate } }),
      );
      expect(market[0].totalAmount).toBe(dataset === 'calendar' ? null : 100);
      const lastAffected = dataset === 'calendar' ? fixture.following[58] : fixture.following[19];
      const firstIndependent =
        dataset === 'calendar' ? fixture.following[59] : fixture.following[20];
      expect(
        await database.marketCalculationState.findFirstOrThrow({ where: { date: lastAffected } }),
      ).toMatchObject({ status: 'stale', generation: 2 });
      expect(
        await database.marketCalculationState.findFirstOrThrow({
          where: { date: firstIndependent },
        }),
      ).toMatchObject({ status: 'ready', generation: 1 });
      expect(
        await database.indexDaily.findMany({ orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }] }),
      ).toEqual(prices);
      expect(await database.tradeCal.findMany({ orderBy: { calDate: 'asc' } })).toEqual(calendar);

      control.deferCalculations = false;
      await database.marketCalculationState.updateMany({
        where: { date: { not: outputDate } },
        data: { nextAttemptAt: new Date('2099-01-01T00:00:00Z') },
      });
      await withMaintenanceLock(() =>
        refreshMarketCalculations({ targetDate: '20251231', limit: 1 }),
      );
      const waiting = await currentDerivedRows(
        await database.indexIndicator.findMany({
          where: { tradeDate: outputDate },
          orderBy: { indexCode: 'asc' },
        }),
      );
      expect(waiting[0].return20).toBeNull();
      expect(waiting[0].totalAmount).toBe(100);
      expect(waiting[1].return20).toBe(dataset === 'calendar' ? null : original[1].return20);

      restored = true;
      control.preparationFailure = false;
      control.deferCalculations = true;
      const repaired = await synchronizeData(input);
      expect(repaired.accepted).toEqual({ inserted: 0, updated: 0, deleted: 0, rejected: 0 });
      expect(
        await database.datasetSyncPartition.findUniqueOrThrow({ where: { id } }),
      ).toMatchObject({ status: 'complete' });
      const pending = await currentDerivedRows(
        await database.indexIndicator.findMany({
          where: { tradeDate: outputDate },
          orderBy: { indexCode: 'asc' },
        }),
      );
      expect(pending[0].return20).toBeNull();
      control.deferCalculations = false;
      await database.marketCalculationState.updateMany({
        where: { date: { not: outputDate } },
        data: { nextAttemptAt: new Date('2099-01-01T00:00:00Z') },
      });
      await withMaintenanceLock(() =>
        refreshMarketCalculations({ targetDate: '20251231', limit: 1 }),
      );
      const ready = await currentDerivedRows(
        await database.indexIndicator.findMany({
          where: { tradeDate: outputDate },
          orderBy: { indexCode: 'asc' },
        }),
      );
      expect(ready.map((row) => row.return20)).toEqual(original.map((row) => row.return20));
      expect(
        await database.marketCalculationState.findFirstOrThrow({ where: { date: outputDate } }),
      ).toMatchObject({ status: 'ready', generation: 3, readyGeneration: 3 });
    }),
  60_000,
);
