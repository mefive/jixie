import { factorAnalysisJobPayloadSchema } from './job-payload.js';
import type { FactorAnalysisWorkerInput } from '../execution/worker-input.js';
import { factorAnalysisWorkerMessageSchema } from '../execution/worker-protocol.js';
import { t } from '#i18n/messages.js';
import type { JobLifecycle } from '#jobs/lifecycle.js';
import { FactorWorkerError } from '../errors.js';
import { runWorker } from '#jobs/worker.js';
import { Worker } from 'node:worker_threads';

const workerUrl = import.meta.url.endsWith('.ts')
  ? new URL('../execution/worker.boot.mjs', import.meta.url)
  : new URL('../execution/worker.js', import.meta.url);

export const factorAnalysisLifecycle = {
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
  },
  async onFailure(transaction, job, error) {
    if (error instanceof FactorWorkerError && job.factorReportId) {
      await transaction.factorReport.update({
        where: { id: job.factorReportId, userId: job.userId },
        data: { failureMessage: error.failureMessage, computedAt: null },
      });
    }
  },
} satisfies JobLifecycle<{ reportId: string; output: string }>;
