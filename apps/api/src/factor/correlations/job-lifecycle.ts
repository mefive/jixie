import { factorCorrelationWorkerMessageSchema } from './worker-protocol.js';
import { Worker } from 'node:worker_threads';
import { factorCorrelationJobPayloadSchema } from './job-payload.js';
import { t } from '#i18n/messages.js';
import type { JobLifecycle } from '#jobs/lifecycle.js';
import { runWorker } from '#jobs/worker.js';

const workerUrl = import.meta.url.endsWith('.ts')
  ? new URL('./worker.boot.mjs', import.meta.url)
  : new URL('./worker.js', import.meta.url);

export const factorCorrelationLifecycle = {
  async onExecute(job, log) {
    const input = factorCorrelationJobPayloadSchema.parse(job.payload);
    if (input.userId !== job.userId) {
      throw new Error('Factor correlation payload does not match its persisted owner');
    }
    if (job.factorReportId !== null) {
      throw new Error('Factor correlation job must not reference an analysis report');
    }
    const output = await runWorker<string>({
      onLog: log,
      start: () => new Worker(workerUrl, { workerData: input }),
      readMessage: (raw) => factorCorrelationWorkerMessageSchema.parse(raw),
      exitedMessage: (code) => t(input.locale, 'factorProcExited', { code: code ?? 'unknown' }),
    });

    return { id: input.id, output };
  },
  async onSuccess(transaction, job, { id, output }) {
    const computedAt = new Date();
    await transaction.factorCorrelation.upsert({
      where: { id: id },
      create: { id: id, userId: job.userId, payload: output, computedAt },
      update: { payload: output, computedAt },
    });
  },
} satisfies JobLifecycle<{ id: string; output: string }>;
