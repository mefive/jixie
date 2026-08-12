import { Worker } from 'node:worker_threads';
import type {
  BacktestConfig,
  Locale,
  LogLine,
  StrategyParamValue,
  StrategyScanPayload,
  StrategyScanSpec,
} from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { t } from '../i18n/messages.js';
import { appendLog, finishStrategyScanJob } from '../lib/jobs.js';
import { codeConfigSchema } from './code/schema.js';

const workerUrl = import.meta.url.endsWith('.ts')
  ? new URL('../engine/strategy-scan-worker.boot.mjs', import.meta.url)
  : new URL('../engine/strategy-scan-worker.js', import.meta.url);

const payloadSchema = z.object({
  task: z.literal('strategy-scan'),
  reportId: z.string().min(1),
  config: codeConfigSchema,
  spec: z.object({
    dimensions: z.array(
      z.object({
        key: z.string().min(1),
        values: z.array(z.union([z.number(), z.string()])),
      }),
    ),
    splitDate: z.string().optional(),
    view: z.enum(['parameters', 'sizing', 'capacity']).optional(),
  }),
  parameters: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
  ranges: z.union([
    z.object({ full: z.object({ start: z.string(), end: z.string() }) }),
    z.object({
      inSample: z.object({ start: z.string(), end: z.string() }),
      outOfSample: z.object({ start: z.string(), end: z.string() }),
    }),
  ]),
  userId: z.string().min(1),
  locale: z.enum(['zh', 'en']),
});

/** Execute one durable strategy-scan Job inside the shared bounded scheduler. */
export async function runStrategyScanJob(
  jobId: string,
  rawPayload: Record<string, unknown>,
): Promise<void> {
  const parsed = payloadSchema.parse(rawPayload);
  const payload = parsed as typeof parsed & {
    config: BacktestConfig;
    spec: StrategyScanSpec;
    parameters: Record<string, StrategyParamValue>;
    locale: Locale;
  };

  await new Promise<void>((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(workerUrl, {
        workerData: {
          config: payload.config,
          spec: payload.spec,
          parameters: payload.parameters,
          ranges: payload.ranges,
          userId: payload.userId,
          locale: payload.locale,
        },
      });
    } catch (error) {
      void finishStrategyScanJob(
        jobId,
        payload.reportId,
        'error',
        undefined,
        error instanceof Error ? error.message : String(error),
      ).finally(resolve);
      return;
    }

    let finalized = false;
    let terminal:
      | { status: 'done'; payload: StrategyScanPayload }
      | { status: 'error'; error?: string }
      | null = null;
    const finalize = async (
      status: 'done' | 'error',
      result?: StrategyScanPayload,
      error?: string,
    ) => {
      if (finalized) {
        return;
      }
      finalized = true;
      await finishStrategyScanJob(
        jobId,
        payload.reportId,
        status,
        result ? jsonValue(result) : undefined,
        error,
      );
      resolve();
    };
    worker.on(
      'message',
      (message: {
        type: string;
        entry?: LogLine;
        payload?: StrategyScanPayload;
        message?: string;
      }) => {
        if (message.type === 'log' && message.entry) {
          appendLog(jobId, message.entry);
        } else if (message.type === 'done' && message.payload) {
          terminal = { status: 'done', payload: message.payload };
        } else if (message.type === 'error') {
          terminal = { status: 'error', error: message.message };
        }
      },
    );
    worker.on('error', (error) => void finalize('error', undefined, error.message));
    worker.on('exit', (code) => {
      if (finalized) {
        return;
      }
      if (code !== 0 || !terminal) {
        void finalize('error', undefined, t(payload.locale, 'strategyScanProcExited', { code }));
      } else if (terminal.status === 'error') {
        void finalize('error', undefined, terminal.error);
      } else {
        void finalize('done', terminal.payload);
      }
    });
  });
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
