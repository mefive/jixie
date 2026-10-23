import { expect, it, vi } from 'vitest';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import { generateDailySignals } from './scheduler.js';
import { runSyncConsumers } from '#maintenance/consumers.js';
import { synchronizeData } from '#maintenance/sync.js';

vi.mock('#strategy/sandbox/inspect-definition.js', () => ({
  inspectStrategyMetadata: async () => ({ watch: [] }),
}));
vi.mock('#market/calendar/sse-close.js', async (original) => ({
  ...(await original<typeof import('#market/calendar/sse-close.js')>()),
  latestCompletedTradeDate: async () => '20260915',
}));
vi.mock('#maintenance/partitions.js', async (original) => ({
  ...(await original<typeof import('#maintenance/partitions.js')>()),
  planSyncPartitions: async () => ({ partitions: [], gaps: [] }),
}));

it(
  'R14/A07/A13 propagates real account failures, normal waiting and retry recovery despite completed signals',
  async () =>
    withSyncDatabase(async (database) => {
      const date = '20260915';
      const config = {
        name: 'Fixture',
        code: 'fixture',
        start: '20260914',
        end: date,
        initialCash: 100000,
      };
      await database.user.create({ data: { id: 'owner', email: 'fixture@example.invalid' } });
      await database.strategy.create({
        data: { id: 'strategy', userId: 'owner', name: 'Fixture', config },
      });
      await database.etfBasic.create({
        data: {
          tsCode: '510300.SH',
          name: 'Fixture ETF',
          listStatus: 'L',
          exchange: 'SSE',
          sameDayTurnover: false,
        },
      });
      await database.tradeCal.createMany({
        data: ['20260914', date, '20260916'].map((calDate) => ({
          exchange: 'SSE',
          calDate,
          isOpen: 1,
        })),
      });
      await database.datasetSyncPartition.createMany({
        data: [
          'calendar',
          'stock-prices',
          'stock-adjustments',
          'stock-valuations',
          'stock-limits',
        ].map((dataset) => ({
          id: dataset,
          dataset,
          scope: dataset === 'calendar' ? 'SSE' : 'all',
          startDate: '20260914',
          endDate: '20260916',
          status: 'complete',
          policyVersion: 'sync-v1',
        })),
      });
      for (const id of ['failing', 'waiting', 'healthy']) {
        await database.strategyDeployment.create({
          data: {
            id,
            userId: 'owner',
            strategyId: 'strategy',
            strategyName: id,
            codeHash: 'fixture',
            config,
            locale: 'en',
            status: id === 'healthy' ? 'active' : 'paused',
          },
        });
        await database.signalRun.create({
          data: {
            id: `${id}-run`,
            deploymentId: id,
            userId: 'owner',
            strategyId: 'strategy',
            tradeDate: '20260914',
            execDate: date,
            legacyStatus: 'done',
          },
        });
        for (const kind of ['simulation', 'actual']) {
          await database.strategyAccountSnapshot.create({
            data: {
              id: `${id}-${kind}`,
              deploymentId: id,
              userId: 'owner',
              kind,
              tradeDate: '20260914',
              isBaseline: true,
              cash: 100000,
              equity: 100000,
              marketValue: 0,
              positions:
                id === 'waiting'
                  ? [
                      {
                        code: '510300.SH',
                        name: 'Fixture ETF',
                        assetType: 'etf',
                        shares: 100,
                        avgCost: 10,
                        markPrice: 10,
                        sellableFrom: '20260914',
                      },
                    ]
                  : [],
            },
          });
        }
      }
      await database.signalRun.create({
        data: {
          id: 'completed-today',
          deploymentId: 'healthy',
          userId: 'owner',
          strategyId: 'strategy',
          tradeDate: date,
          execDate: '20260916',
          legacyStatus: 'done',
        },
      });
      // 真正的 SQLite 写入失败只影响一个账户，模拟账户和实际账户分别重试。
      // A real SQLite write failure affects one account; simulation and actual accounts retry independently.
      await database.$executeRawUnsafe(`CREATE TRIGGER reject_fixture_account BEFORE INSERT ON StrategyAccountSnapshot
      WHEN NEW.deploymentId = 'failing' AND NEW.isBaseline = 0
      BEGIN SELECT RAISE(ABORT, 'Controlled account persistence failure'); END`);
      const scheduled = await generateDailySignals(date, () => {});
      expect(scheduled).toMatchObject({
        deployments: 1,
        done: 1,
        waiting: 0,
        errors: 0,
        accounts: { deployments: 3, done: 2, waiting: 2, errors: 2 },
      });
      expect(
        scheduled.accounts.failures.every((failure) => failure.startsWith('Account failing/')),
      ).toBe(true);
      expect(scheduled.accounts.gaps.every((gap) => gap.startsWith('Account waiting/'))).toBe(true);
      const consumers = await runSyncConsumers(date);
      expect(consumers.errors).toHaveLength(2);
      expect(consumers.gaps).toHaveLength(2);
      const input = {
        targetDate: date,
        startedAt: new Date('2026-09-16T10:00:00Z'),
        requirements: { etfCodes: [] },
        onLog: () => {},
        providers: {
          source: { call: async () => [] },
          treasury: { fetchRange: async () => [] },
          credit: { fetchRange: async () => [] },
          cpi: { loadSeries: async () => [] },
        },
      };
      expect((await synchronizeData(input)).status).toBe('error');

      await database.$executeRawUnsafe('DROP TRIGGER reject_fixture_account');
      const waiting = await synchronizeData(input);
      expect(waiting.status).toBe('partial');
      expect(waiting.errors).toEqual([]);
      expect(waiting.gaps).toHaveLength(2);
      await database.etfDaily.create({ data: { tsCode: '510300.SH', tradeDate: date, close: 11 } });
      await database.datasetSyncPartition.create({
        data: {
          id: 'etf-price',
          dataset: 'etf-prices',
          scope: '510300.SH',
          startDate: date,
          endDate: date,
          status: 'complete',
          policyVersion: 'sync-v1',
        },
      });
      const recovered = await synchronizeData(input);
      expect(recovered).toMatchObject({ status: 'complete', errors: [], gaps: [] });
      expect(await database.strategyAccountSnapshot.count({ where: { isBaseline: false } })).toBe(
        6,
      );
      expect(await database.job.count()).toBe(0);
      expect(await database.signalRun.count()).toBe(4);
      expect((await generateDailySignals(date, () => {})).accounts).toMatchObject({
        done: 6,
        waiting: 0,
        errors: 0,
      });
      expect(await database.strategyAccountSnapshot.count({ where: { isBaseline: false } })).toBe(
        6,
      );
    }),
  30_000,
);
