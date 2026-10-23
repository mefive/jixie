import { withMarketAccess } from '#infra/coordination/market-access.js';
import { JobService } from '#jobs/job-service.js';
import { registerJobLifecycles } from '#jobs/register.js';
import { getDatabase } from '#infra/database/prisma.js';
import { settleStrategyAccounts, type AccountSettlementResult } from '../accounting/settlement.js';
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
  signal: AbortSignal = AbortSignal.timeout(30 * 60_000),
): Promise<{
  deployments: number;
  done: number;
  waiting: number;
  errors: number;
  accounts: AccountSettlementResult;
}> {
  return withMarketAccess(async () => {
    registerJobLifecycles();
    signal.throwIfAborted();
    await JobService.recoverInterrupted('signal', signal);
    signal.throwIfAborted();
    const open = await getDatabase().tradeCal.findUnique({
      where: { exchange_calDate: { exchange: 'SSE', calDate: tradeDate } },
      select: { isOpen: true },
    });
    if (!open || open.isOpen !== 1) {
      return {
        deployments: 0,
        done: 0,
        waiting: 0,
        errors: 0,
        accounts: { deployments: 0, done: 0, waiting: 0, errors: 0, gaps: [], failures: [] },
      };
    }

    const accounts = await settleStrategyAccounts(tradeDate, onLog, signal);

    const deployments = await getDatabase().strategyDeployment.findMany({
      where: { status: 'active' },
      orderBy: { deployedAt: 'asc' },
      select: { id: true, userId: true, strategyName: true },
    });
    let done = 0;
    let errors = 0;
    let waiting = 0;

    for (const deployment of deployments) {
      if (signal.aborted) {
        waiting += deployments.length - done - errors - waiting;
        break;
      }
      onLog(`Generating ${deployment.strategyName} (${deployment.id})`);
      let run;
      try {
        run = await enqueueSignalRun(deployment.userId, deployment.id, tradeDate, signal);
      } catch (error) {
        if (
          error instanceof SignalsError &&
          ['data_not_ready', 'next_date_missing'].includes(error.reason)
        ) {
          waiting++;
        } else {
          errors++;
        }
        onLog(
          `Skipped ${deployment.strategyName}: ${error instanceof SignalsError ? error.reason : String(error)}`,
        );
        continue;
      }
      // 仅执行本地持有的任务；其他活跃消费者不被抢占，等待受本轮取消约束。
      // Execute only locally owned work; respect active owners and the run's cancellation budget.
      if (run.jobId && (await JobService.claim(run.jobId))) {
        await JobService.execute(run.jobId, signal);
      }
      const status = await run.completion;
      if (status === 'done') {
        done++;
      } else if (status === 'error') {
        errors++;
      } else {
        waiting++;
      }
    }

    return { deployments: deployments.length, done, waiting, errors, accounts };
  });
}
