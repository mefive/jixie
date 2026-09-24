import { backtestJobPayloadSchema, type BacktestWorkerInput } from './job-payload.js';
import { backtestWorkerMessageSchema } from './worker-protocol.js';
import { Worker } from 'node:worker_threads';
import type { BacktestSummary } from '@jixie/shared';
import type { JobLifecycle } from '#jobs/lifecycle.js';
import { runWorker } from '#jobs/worker.js';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { t } from '#i18n/messages.js';

const workerUrl = import.meta.url.endsWith('.ts')
  ? new URL('./worker.boot.mjs', import.meta.url)
  : new URL('./worker.js', import.meta.url);

export const strategyBacktestLifecycle = {
  async onExecute(job, log) {
    const input = backtestJobPayloadSchema.parse(job.payload);
    if (input.reportId !== job.backtestReportId || input.userId !== job.userId) {
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
    const resultHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');

    return { reportId: input.reportId, strategyId: input.strategyId, payload, resultHash };
  },
  async onSuccess(transaction, job, { reportId, strategyId, payload, resultHash }) {
    await transaction.backtestReport.update({
      where: { id: reportId, userId: job.userId },
      data: { payload, resultHash, computedAt: new Date() },
    });
    await transaction.strategy.updateMany({
      where: { id: strategyId, userId: job.userId },
      data: { lastResult: payload },
    });
  },
} satisfies JobLifecycle<{
  reportId: string;
  strategyId: string;
  payload: Prisma.InputJsonValue;
  resultHash: string;
}>;
