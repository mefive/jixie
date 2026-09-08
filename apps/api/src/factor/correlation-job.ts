import { Worker } from 'node:worker_threads';
import type { FactorFreq, Locale } from '@jixie/shared';
import { z } from 'zod';
import { t } from '../i18n/messages.js';
import { defineJob } from '../infra/jobs/definition.js';
import { runJobWorker, type JobWorkerMessage } from '../infra/jobs/worker-result.js';

const workerUrl = import.meta.url.endsWith('.ts')
  ? new URL('./correlation-worker.boot.mjs', import.meta.url)
  : new URL('./correlation-worker.js', import.meta.url);

const payloadSchema = z.object({
  task: z.literal('correlation'),
  id: z.string().min(1),
  userId: z.string().min(1),
  keys: z.array(z.string().min(1)).min(2).max(8),
  freq: z.enum(['week', 'month']),
  start: z.string().regex(/^\d{8}$/),
  end: z.string().regex(/^\d{8}$/),
  locale: z.enum(['zh', 'en']),
});

export const factorCorrelationJob = defineJob({
  parse(raw, job) {
    const input = payloadSchema.parse(raw) as z.infer<typeof payloadSchema> & {
      freq: FactorFreq;
      locale: Locale;
    };
    if (input.userId !== job.userId) {
      throw new Error('Factor correlation payload does not match its persisted owner');
    }
    return input;
  },
  async execute(context, input): Promise<string> {
    const output = await runJobWorker<string>({
      context,
      start: () => new Worker(workerUrl, { workerData: input }),
      readMessage: (message) => message as JobWorkerMessage<string>,
      exitedMessage: (code) => t(input.locale, 'factorProcExited', { code: code ?? 'unknown' }),
    });
    return z.string().parse(output);
  },
  async complete(transaction, job, input, output) {
    const computedAt = new Date();
    await transaction.factorCorrelation.upsert({
      where: { id: input.id },
      create: { id: input.id, userId: job.userId, payload: output, computedAt },
      update: { payload: output, computedAt },
    });
  },
  async fail() {
    // No running report is associated with this cache task.
  },
  async recover() {
    // Preserve any last successful cache; only the Job becomes stale.
  },
});
