import { Worker } from 'node:worker_threads';
import type { BacktestConfig, BacktestSummary, Locale, LogLine } from '@jixie/shared';
import { z } from 'zod';
import { appendLog, finishBacktestReportJob } from '../lib/jobs.js';
import { t } from '../i18n/messages.js';
import { codeConfigSchema } from './code/schema.js';
import { refreshStrategyName, strategyRunKey } from '../services/strategy-service.js';

const workerUrl = import.meta.url.endsWith('.ts')
  ? new URL('../engine/backtest-worker.boot.mjs', import.meta.url)
  : new URL('../engine/backtest-worker.js', import.meta.url);

const backtestJobPayloadSchema = z.object({
  task: z.literal('backtest'),
  reportId: z.string().min(1),
  strategyId: z.string().min(1),
  userId: z.string().min(1),
  locale: z.enum(['zh', 'en']),
  config: codeConfigSchema,
});

export type BacktestJobPayload = z.infer<typeof backtestJobPayloadSchema>;

/** Execute one claimed backtest Job and resolve only after its worker and durable finalization finish. */
export async function runBacktestJob(
  jobId: string,
  rawPayload: Record<string, unknown>,
): Promise<void> {
  const payload = backtestJobPayloadSchema.parse(rawPayload) as BacktestJobPayload & {
    config: BacktestConfig;
    locale: Locale;
  };

  await new Promise<void>((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(workerUrl, {
        workerData: {
          config: payload.config,
          userId: payload.userId,
          strategyId: payload.strategyId,
          locale: payload.locale,
        },
      });
    } catch (error) {
      void finishBacktestReportJob(
        jobId,
        payload.reportId,
        payload.strategyId,
        payload.userId,
        'error',
        undefined,
        error instanceof Error ? error.message : String(error),
      ).finally(resolve);
      return;
    }

    let finalized = false;
    let terminalMessage:
      | { status: 'done'; payload: BacktestSummary }
      | { status: 'error'; error?: string }
      | null = null;
    const finalize = async (status: 'done' | 'error', result?: BacktestSummary, error?: string) => {
      if (finalized) {
        return;
      }
      finalized = true;
      if (status === 'done') {
        await refreshStrategyName({
          id: payload.strategyId,
          userId: payload.userId,
          code: payload.config.code,
          currentName: payload.config.name,
          expectedRunKey: strategyRunKey(payload.config),
          locale: payload.locale,
        }).catch((renameError) => {
          console.error('[jixie] strategy rename failed', renameError);
          return false;
        });
      }
      await finishBacktestReportJob(
        jobId,
        payload.reportId,
        payload.strategyId,
        payload.userId,
        status,
        result,
        error,
      );
      resolve();
    };

    worker.on(
      'message',
      (message: { type: string; entry?: LogLine; payload?: BacktestSummary; message?: string }) => {
        switch (message.type) {
          case 'log':
            appendLog(jobId, message.entry!);
            break;
          case 'done':
            if (message.payload) {
              terminalMessage = { status: 'done', payload: message.payload };
            }
            break;
          case 'error':
            terminalMessage = { status: 'error', error: message.message };
            break;
        }
      },
    );
    worker.on('error', (error) => void finalize('error', undefined, error.message));
    worker.on('exit', (code) => {
      if (finalized) {
        return;
      }
      if (code !== 0 || !terminalMessage) {
        void finalize('error', undefined, t(payload.locale, 'backtestProcExited', { code }));
      } else if (terminalMessage.status === 'error') {
        void finalize('error', undefined, terminalMessage.error);
      } else {
        void finalize('done', terminalMessage.payload);
      }
    });
  });
}
