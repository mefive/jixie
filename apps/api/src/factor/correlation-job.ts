import { Worker } from 'node:worker_threads';
import type { FactorFreq, Locale, LogLine } from '@jixie/shared';
import { z } from 'zod';
import { t } from '../i18n/messages.js';
import { appendLog, finishJob } from '../lib/jobs.js';

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

/** Execute one factor-correlation job inside the shared bounded scheduler. */
export async function runFactorCorrelationJob(
  jobId: string,
  rawPayload: Record<string, unknown>,
): Promise<void> {
  const payload = payloadSchema.parse(rawPayload) as z.infer<typeof payloadSchema> & {
    freq: FactorFreq;
    locale: Locale;
  };
  await new Promise<void>((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(workerUrl, { workerData: payload });
    } catch (error) {
      void finishJob(
        jobId,
        'error',
        error instanceof Error ? error.message : String(error),
      ).finally(resolve);
      return;
    }
    let finalized = false;
    let terminal: 'done' | { error?: string } | null = null;
    const finalize = async (status: 'done' | 'error', error?: string) => {
      if (finalized) {
        return;
      }
      finalized = true;
      await finishJob(jobId, status, error);
      resolve();
    };
    worker.on('message', (message: { type: string; entry?: LogLine; message?: string }) => {
      switch (message.type) {
        case 'log':
          appendLog(jobId, message.entry!);
          break;
        case 'done':
          terminal = 'done';
          break;
        case 'error':
          terminal = { error: message.message };
          break;
      }
    });
    worker.on('error', (error) => void finalize('error', error.message));
    worker.on('exit', (code) => {
      if (finalized) {
        return;
      }
      if (code !== 0 || terminal == null) {
        void finalize('error', t(payload.locale, 'factorProcExited', { code }));
      } else if (terminal === 'done') {
        void finalize('done');
      } else {
        void finalize('error', terminal.error);
      }
    });
  });
}
