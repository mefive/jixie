import { Worker } from 'node:worker_threads';
import type {
  BacktestConfig,
  Locale,
  StrategyParamValue,
  StrategyScanPayload,
  StrategyScanSpec,
} from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { t } from '#i18n/messages.js';
import { defineJob } from '#infra/jobs/definition.js';
import { runJobWorker, type JobWorkerMessage } from '#infra/jobs/worker-result.js';
import { codeConfigSchema } from './runtime/typescript/schema.js';

const workerUrl = import.meta.url.endsWith('.ts')
  ? new URL('./scans/strategy-scan-worker.boot.mjs', import.meta.url)
  : new URL('./scans/strategy-scan-worker.js', import.meta.url);

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

export const strategyScanJob = defineJob({
  parse(raw, job) {
    const parsed = payloadSchema.parse(raw);
    const input = parsed as typeof parsed & {
      config: BacktestConfig;
      spec: StrategyScanSpec;
      parameters: Record<string, StrategyParamValue>;
      locale: Locale;
    };
    if (input.reportId !== job.strategyScanReportId || input.userId !== job.userId) {
      throw new Error('Strategy scan payload does not match its persisted owner or report');
    }
    return input;
  },
  async execute(context, input): Promise<Prisma.InputJsonValue> {
    const output = await runJobWorker<StrategyScanPayload>({
      context,
      start: () =>
        new Worker(workerUrl, {
          workerData: {
            config: input.config,
            spec: input.spec,
            parameters: input.parameters,
            ranges: input.ranges,
            userId: input.userId,
            locale: input.locale,
          },
        }),
      readMessage: (message) => message as JobWorkerMessage<StrategyScanPayload>,
      exitedMessage: (code) =>
        t(input.locale, 'strategyScanProcExited', { code: code ?? 'unknown' }),
    });
    return JSON.parse(JSON.stringify(output)) as Prisma.InputJsonValue;
  },
  async complete(transaction, job, input, output) {
    await transaction.strategyScanReport.update({
      where: { id: input.reportId, userId: job.userId, status: 'running' },
      data: { status: 'done', payload: output, error: null },
    });
  },
  async fail(transaction, jobs, failure) {
    for (const job of jobs) {
      const id = job.strategyScanReportId;
      if (!id) {
        continue;
      }
      await transaction.strategyScanReport.updateMany({
        where: { id, status: { in: ['queued', 'running'] } },
        data: { status: 'error', error: failure.message },
      });
    }
  },
  async recover(transaction, jobs) {
    const ids = jobs.map((job) => job.strategyScanReportId).filter((id): id is string => !!id);
    if (ids.length > 0) {
      await transaction.strategyScanReport.updateMany({
        where: { id: { in: ids }, status: 'running' },
        data: { status: 'stale', error: null },
      });
    }
  },
});
