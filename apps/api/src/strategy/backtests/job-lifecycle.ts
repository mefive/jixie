import { backtestJobPayloadSchema, type BacktestWorkerInput } from './job-payload.js';
import { backtestWorkerMessageSchema } from './worker-protocol.js';
import { Worker } from 'node:worker_threads';
import type { BacktestSummary } from '@jixie/shared';
import type { JobLifecycle } from '#jobs/lifecycle.js';
import { runWorker } from '#jobs/worker.js';
import { finishStrategyJob } from '../results/retention.js';
import type { Prisma } from '@prisma/client';
import { t } from '#i18n/messages.js';

const workerUrl = import.meta.url.endsWith('.ts')
  ? new URL('./worker.boot.mjs', import.meta.url)
  : new URL('./worker.js', import.meta.url);

export const strategyBacktestLifecycle = {
  /**
   * 在任务事务外调用回测计算，结果由生命周期终态事务保存。
   *
   * Compute a backtest outside the terminal transaction for later lifecycle persistence.
   */
  async onExecute(job, log) {
    const input = backtestJobPayloadSchema.parse(job.payload);
    if (
      input.reportId !== job.backtestReportId ||
      input.userId !== job.userId ||
      input.strategyId !== job.key
    ) {
      throw new Error('Backtest job payload does not match its persisted owner or report');
    }

    const result = await runWorker<BacktestSummary>({
      onLog: log,
      start: () =>
        new Worker(workerUrl, {
          workerData: {
            config: input.config,
            userId: input.userId,
            strategyId: input.strategyId,
            locale: input.locale,
          } satisfies BacktestWorkerInput,
        }),
      readMessage: (raw) => backtestWorkerMessageSchema.parse(raw),
      exitedMessage: (code) => t(input.locale, 'backtestProcExited', { code: code ?? 'unknown' }),
    });

    const payload = JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue;

    return { reportId: input.reportId, strategyId: input.strategyId, payload };
  },
  async onSuccess(transaction, job, { reportId, payload }) {
    await transaction.backtestReport.update({
      where: { id: reportId, userId: job.userId },
      data: { payload, computedAt: new Date() },
    });
    await finishStrategyJob(transaction, job);
  },
  onFailure: finishStrategyJob,
  onInterrupted: finishStrategyJob,
} satisfies JobLifecycle<{
  reportId: string;
  strategyId: string;
  payload: Prisma.InputJsonValue;
}>;
