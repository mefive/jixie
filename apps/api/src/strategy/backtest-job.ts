import { Worker } from 'node:worker_threads';
import type { BacktestConfig, BacktestSummary, Locale } from '@jixie/shared';
import { z } from 'zod';
import { defineJob } from '../infra/jobs/definition.js';
import { runJobWorker, type JobWorkerMessage } from '../infra/jobs/worker-result.js';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { t } from '../i18n/messages.js';
import { codeConfigSchema } from './runtime/typescript/schema.js';
import { strategyRunKey } from './definitions/config.js';
import { refreshStrategyName } from './definitions/naming.js';

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

export const backtestJob = defineJob({
  parse(raw, job) {
    const input = backtestJobPayloadSchema.parse(raw) as BacktestJobPayload & {
      config: BacktestConfig;
      locale: Locale;
    };
    if (input.reportId !== job.backtestReportId || input.userId !== job.userId) {
      throw new Error('Backtest job payload does not match its persisted owner or report');
    }
    return input;
  },
  async execute(context, input): Promise<{ payload: Prisma.InputJsonValue; resultHash: string }> {
    const result = await runJobWorker<BacktestSummary>({
      context,
      start: () =>
        new Worker(workerUrl, {
          workerData: {
            config: input.config,
            userId: input.userId,
            strategyId: input.strategyId,
            locale: input.locale,
          },
        }),
      readMessage: (message) => message as JobWorkerMessage<BacktestSummary>,
      exitedMessage: (code) => t(input.locale, 'backtestProcExited', { code: code ?? 'unknown' }),
    });
    // Preserve the existing best-effort rename before finalizing the report.
    await refreshStrategyName({
      id: input.strategyId,
      userId: input.userId,
      code: input.config.code,
      currentName: input.config.name,
      expectedRunKey: strategyRunKey(input.config),
      locale: input.locale,
    }).catch((error) => console.error('[jixie] strategy rename failed', error));
    const payload = JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue;
    const resultHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    return { payload, resultHash };
  },
  async complete(transaction, job, input, output) {
    const { payload, resultHash } = output;
    await transaction.backtestReport.update({
      where: { id: input.reportId, userId: job.userId, status: 'running' },
      data: { status: 'done', payload, resultHash, computedAt: new Date(), error: null },
    });
    await transaction.strategy.updateMany({
      where: { id: input.strategyId, userId: job.userId },
      data: { lastResult: payload },
    });
  },
  async fail(transaction, jobs, failure) {
    for (const job of jobs) {
      const id = job.backtestReportId;
      if (!id) {
        continue;
      }
      await transaction.backtestReport.updateMany({
        where: { id, status: { in: ['queued', 'running'] } },
        data: { status: 'error', error: failure.message, computedAt: null },
      });
    }
  },
  async recover(transaction, jobs) {
    const ids = jobs.map((job) => job.backtestReportId).filter((id): id is string => !!id);
    if (ids.length > 0) {
      await transaction.backtestReport.updateMany({
        where: { id: { in: ids }, status: 'running' },
        data: { status: 'stale', error: null },
      });
    }
  },
});
