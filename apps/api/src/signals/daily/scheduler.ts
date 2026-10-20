import { withMarketAccess } from '#infra/coordination/market-access.js';
import { deferMaintenanceAction } from '#infra/coordination/staging-input.js';
import { JobService } from '#jobs/job-service.js';
import { registerJobLifecycles } from '#jobs/register.js';
import { prisma } from '#infra/database/prisma.js';
import { settleStrategyAccounts } from '../accounting/settlement.js';
import { SignalsError } from '../errors.js';
import { enqueueSignalRun } from '../runs/enqueue.js';

/**
 * 基于已发布市场数据截止日为活跃部署生成信号。
 *
 * Generate active-deployment signals from an already-published market-data cutoff.
 */
export async function generateDailySignals(
  tradeDate: string,
  onLog: (line: string) => void = console.log,
): Promise<{ deployments: number; done: number; errors: number }> {
  if (deferMaintenanceAction({ kind: 'signals', tradeDate })) {
    return { deployments: 0, done: 0, errors: 0 };
  }

  return withMarketAccess(async () => {
    registerJobLifecycles();
    const open = await prisma.tradeCal.findUnique({
      where: { exchange_calDate: { exchange: 'SSE', calDate: tradeDate } },
      select: { isOpen: true },
    });
    if (!open || open.isOpen !== 1) {
      return { deployments: 0, done: 0, errors: 0 };
    }

    await settleStrategyAccounts(tradeDate, onLog);
    const deployments = await prisma.strategyDeployment.findMany({
      where: { status: 'active' },
      orderBy: { deployedAt: 'asc' },
      select: { id: true, userId: true, strategyName: true },
    });
    let done = 0;
    let errors = 0;
    for (const deployment of deployments) {
      onLog(`Generating ${deployment.strategyName} (${deployment.id})`);
      let run;
      try {
        run = await enqueueSignalRun(deployment.userId, deployment.id, tradeDate);
      } catch (error) {
        if (!(error instanceof SignalsError)) {
          throw error;
        }
        errors++;
        onLog(`Skipped ${deployment.strategyName}: ${error.reason}`);
        continue;
      }
      // CLI execution is serial and independent of the API scheduler's concurrency limits.
      // A failed claim means another consumer owns or has already completed this attempt.
      if (run.jobId && (await JobService.claim(run.jobId))) {
        await JobService.execute(run.jobId);
      }
      const status = await run.completion;
      if (status === 'done') {
        done++;
      } else if (status === 'error') {
        errors++;
      }
    }
    return { deployments: deployments.length, done, errors };
  });
}
