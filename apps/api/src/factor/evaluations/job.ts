import { t } from '#i18n/messages.js';
import { defineJob } from '#infra/jobs/definition.js';
import { type JobWorkerMessage, runJobWorker } from '#infra/jobs/worker-result.js';
import { type FactorResearchSpecV1, type Locale } from '@jixie/shared';
import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import { normalizeFactorResearchSpec } from '../execution/spec.js';
import {
  type FactorAnalysisSource,
  factorAnalysisRuntimeSourceSchema,
} from '../sources/snapshot.js';

const workerUrl = import.meta.url.endsWith('.ts')
  ? new URL('../execution/worker.boot.mjs', import.meta.url)
  : new URL('../execution/worker.js', import.meta.url);

export interface FactorAnalysisJobPayload {
  reportId: string;
  factor: string;
  source: FactorAnalysisSource;
  spec: FactorResearchSpecV1;
  locale: Locale;
  failedMessage: string;
}

export const factorAnalysisJob = defineJob({
  parse(raw, job): FactorAnalysisJobPayload {
    const payload = z.record(z.string(), z.unknown()).parse(raw);
    const input: FactorAnalysisJobPayload = {
      source: factorAnalysisRuntimeSourceSchema.parse(payload.source),
      spec: normalizeFactorResearchSpec(payload.spec),
      locale: z.enum(['zh', 'en']).parse(payload.locale),
      reportId: z.string().min(1).parse(payload.reportId),
      factor: z.string().min(1).parse(payload.factor),
      failedMessage: z.string().min(1).parse(payload.failedMessage),
    };
    if (input.reportId !== job.factorReportId) {
      throw new Error('Factor analysis payload does not match its persisted report');
    }
    return input;
  },
  async execute(context, input): Promise<string> {
    return runJobWorker<string>({
      context,
      start: () =>
        new Worker(workerUrl, {
          workerData: {
            reportId: input.reportId,
            factor: input.factor,
            source: input.source,
            spec: input.spec,
            locale: input.locale,
          },
        }),
      readMessage: (message) => message as JobWorkerMessage<string>,
      exitedMessage: (code) => t(input.locale, 'factorProcExited', { code: code ?? 'unknown' }),
    });
  },
  async complete(transaction, job, input, output) {
    await transaction.factorReport.update({
      where: { id: input.reportId, userId: job.userId, status: 'running' },
      data: { status: 'done', payload: output, computedAt: new Date(), error: null },
    });
  },
  async fail(transaction, jobs, failure) {
    for (const job of jobs) {
      const id = job.factorReportId;
      if (!id) {
        continue;
      }
      const payload =
        job.payload && typeof job.payload === 'object' && !Array.isArray(job.payload)
          ? job.payload
          : undefined;
      await transaction.factorReport.updateMany({
        where: { id, status: { in: ['queued', 'running'] } },
        data: {
          status: 'error',
          error:
            failure.phase === 'execution' && typeof payload?.failedMessage === 'string'
              ? payload.failedMessage
              : failure.message,
          computedAt: null,
        },
      });
    }
  },
  async recover(transaction, jobs) {
    const ids = jobs.map((job) => job.factorReportId).filter((id): id is string => !!id);
    if (ids.length > 0) {
      await transaction.factorReport.updateMany({
        where: { id: { in: ids }, status: 'running' },
        data: { status: 'stale', error: null },
      });
    }
  },
});
