import { factorAnalysisJobPayloadSchema } from './job-payload.js';
import type { FactorAnalysisWorkerInput } from '../analysis/worker-input.js';
import { factorAnalysisWorkerMessageSchema } from '../analysis/worker-protocol.js';
import { t } from '#i18n/messages.js';
import type { JobLifecycle } from '#jobs/lifecycle.js';
import { FactorWorkerError } from '../errors.js';
import { runWorker } from '#jobs/worker.js';
import { Worker } from 'node:worker_threads';
import { pruneFactorReports } from './retention.js';
import type { Job, Prisma } from '@prisma/client';

const workerUrl = import.meta.url.endsWith('.ts')
  ? new URL('../analysis/worker.boot.mjs', import.meta.url)
  : new URL('../analysis/worker.js', import.meta.url);

export const factorAnalysisLifecycle = {
  /**
   * 执行冻结因子来源计算，报告与 Job 终态由生命周期事务统一提交。
   *
   * Evaluate a frozen factor source for atomic report and job completion.
   */
  async onExecute(job, log) {
    const input = factorAnalysisJobPayloadSchema.parse(job.payload);
    if (input.reportId !== job.factorReportId) {
      throw new Error('Factor analysis payload does not match its persisted report');
    }
    let output: string;
    try {
      output = await runWorker<string>({
        onLog: log,
        start: () =>
          new Worker(workerUrl, {
            workerData: {
              reportId: input.reportId,
              factor: input.factor,
              source: input.source,
              spec: input.spec,
              locale: input.locale,
            } satisfies FactorAnalysisWorkerInput,
          }),
        readMessage: (raw) => factorAnalysisWorkerMessageSchema.parse(raw),
        exitedMessage: (code) => t(input.locale, 'factorProcExited', { code: code ?? 'unknown' }),
      });
    } catch (error) {
      throw new FactorWorkerError(input.failedMessage, error);
    }
    return { reportId: input.reportId, output };
  },
  async onSuccess(transaction, job, { reportId, output }) {
    await transaction.factorReport.update({
      where: { id: reportId, userId: job.userId },
      data: { payload: output, computedAt: new Date() },
    });

    await pruneJobReports(transaction, job);
  },
  async onFailure(transaction, job, error) {
    if (error instanceof FactorWorkerError && job.factorReportId) {
      await transaction.factorReport.update({
        where: { id: job.factorReportId, userId: job.userId },
        data: { failureMessage: error.failureMessage, computedAt: null },
      });
    }

    await pruneJobReports(transaction, job);
  },
  async onInterrupted(transaction, job) {
    await pruneJobReports(transaction, job);
  },
} satisfies JobLifecycle<{ reportId: string; output: string }>;

/**
 * 从持久化关联取得范围，兼容没有新版 payload 的历史任务。
 *
 * Resolve retention scope from persisted ownership, including historical jobs without modern payloads.
 */
async function pruneJobReports(transaction: Prisma.TransactionClient, job: Job): Promise<void> {
  if (!job.factorReportId) {
    return;
  }
  const report = await transaction.factorReport.findFirst({
    where: { id: job.factorReportId, userId: job.userId },
    select: { factor: true },
  });
  if (report) {
    await pruneFactorReports(transaction, { userId: job.userId, factor: report.factor });
  }
}
