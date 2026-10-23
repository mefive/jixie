import { describe, expect, it } from 'vitest';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import { updateActualExecution } from './executions.js';
import { initializeSignalAccounting } from './initialize.js';
import { getStrategyExecutionOverview } from './read.js';
import { settleStrategyAccounts } from './settlement.js';

describe('strategy execution accounting database flow', () => {
  it('initializes, settles, records an actual fill, and rebuilds both account curves', async () => {
    return withSyncDatabase(async (prisma) => {
      const userId = 'accounting-test-user';
      const strategyId = 'accounting-test-strategy';
      const deploymentId = 'accounting-test-deployment';
      const runId = 'accounting-test-run';
      await prisma.user.create({
        data: { id: userId, email: 'accounting-test@jixie.local' },
      });
      await prisma.strategy.create({
        data: {
          id: strategyId,
          userId,
          name: 'Accounting fixture',
          config: {
            name: 'Accounting fixture',
            start: '20230101',
            end: '20240101',
            initialCash: 100_000,
            code: 'export default {}',
            cost: { slippageBps: 0, impactCoef: 0 },
          },
        },
      });
      await prisma.strategyDeployment.create({
        data: {
          id: deploymentId,
          userId,
          strategyId,
          strategyName: 'Accounting fixture',
          status: 'active',
          config: {
            name: 'Accounting fixture',
            start: '20230101',
            end: '20240101',
            initialCash: 100_000,
            code: 'export default {}',
            cost: { slippageBps: 0, impactCoef: 0 },
          },
          codeHash: 'fixture',
          locale: 'en',
        },
      });
      await prisma.tradeCal.createMany({
        data: [
          { exchange: 'SSE', calDate: '20240101', isOpen: 1 },
          { exchange: 'SSE', calDate: '20240102', isOpen: 1 },
          { exchange: 'SSE', calDate: '20240103', isOpen: 1 },
        ],
      });
      await prisma.daily.create({
        data: {
          tsCode: '000001.SZ',
          tradeDate: '20240102',
          open: 10,
          close: 10.5,
          amount: 100_000,
        },
      });
      await prisma.stkLimit.create({
        data: {
          tsCode: '000001.SZ',
          tradeDate: '20240102',
          upLimit: 11,
          downLimit: 9,
        },
      });
      await prisma.datasetSyncPartition.createMany({
        data: ['calendar', 'stock-prices', 'stock-limits'].map((dataset) => ({
          id: dataset,
          dataset,
          scope: dataset === 'calendar' ? 'SSE' : 'all',
          startDate: dataset === 'calendar' ? '20240101' : '20240102',
          endDate: dataset === 'calendar' ? '20240103' : '20240102',
          status: 'complete',
          policyVersion: 'sync-v1',
        })),
      });
      await prisma.signalRun.create({
        data: {
          id: runId,
          userId,
          deploymentId,
          strategyId,
          tradeDate: '20240101',
          execDate: '20240102',
          legacyStatus: 'done',
          dataCutoff: '20240101',
          modelEquity: 100_000,
          modelCash: 100_000,
          modelPositions: [],
          signals: [
            {
              code: '000001.SZ',
              name: 'Ping An Bank',
              assetType: 'stock',
              action: 'buy',
              shares: 100,
              refPrice: 9.8,
              refAmount: 980,
              source: 'order',
            },
          ],
        },
      });

      await initializeSignalAccounting(runId);
      const settlement = await settleStrategyAccounts('20240102', () => {});

      expect(settlement, settlement.gaps.join('; ')).toMatchObject({
        done: 2,
        waiting: 0,
        errors: 0,
      });
      const execution = await prisma.signalExecution.findFirstOrThrow({
        where: { signalRunId: runId },
      });
      expect(execution).toMatchObject({
        simulatedStatus: 'filled',
        simulatedShares: 100,
        simulatedPrice: 10,
      });

      const update = await updateActualExecution(userId, execution.id, {
        status: 'filled',
        shares: 100,
        price: 10.08,
        fee: 6,
      });
      expect(update).toEqual({ runId });

      const overview = await getStrategyExecutionOverview(userId, deploymentId);
      expect(overview?.simulation).toHaveLength(2);
      expect(overview?.actual).toHaveLength(2);
      expect(overview?.execution).toMatchObject({
        total: 1,
        filled: 1,
        executionRate: 1,
      });
      expect(overview?.execution.averagePriceDeviationBps).toBeCloseTo(80, 8);
    });
  });
});
