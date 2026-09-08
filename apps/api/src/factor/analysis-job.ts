import { Worker } from 'node:worker_threads';
import type {
  FactorLanguage,
  FactorAnalysisSpec,
  FactorReport,
  FactorResearchIntentV1,
  FactorResearchSpecV1,
  Locale,
  RunFactorAnalysisResponse,
} from '@jixie/shared';
import { factorRuntimeVersion } from '@jixie/shared';
import { ulid } from 'ulid';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { ACTIVE_JOB_STATUSES } from '../infra/jobs/records.js';
import { initializeJobLogs } from '../infra/jobs/logs.js';
import { defineJob } from '../infra/jobs/definition.js';
import { runJobWorker, type JobWorkerMessage } from '../infra/jobs/worker-result.js';
import { wakeJobQueue } from '../infra/jobs/queue.js';
import { prisma } from '../infra/database/prisma.js';
import { t } from '../i18n/messages.js';
import {
  canonicalJson,
  factorCompositeDefinitionV1Schema,
  factorPanelCompositeDefinitionV2Schema,
  factorTestKey,
  factorVariantKey,
  normalizeFactorResearchSpec,
  sha256,
} from './reports/spec.js';
import type { FactorAnalysisRuntimeSource } from './composition/composite.js';

const workerUrl = import.meta.url.endsWith('.ts')
  ? new URL('./analysis/factor-worker.boot.mjs', import.meta.url)
  : new URL('./analysis/factor-worker.js', import.meta.url);

export type FactorAnalysisSource =
  | FactorAnalysisRuntimeSource
  | {
      kind: 'time_series';
      label: string;
      code: string;
      language?: FactorLanguage;
      runtimeVersion?: 'ts-v1' | 'py-v1';
    }
  | {
      kind: 'panel';
      label: string;
      code: string;
      language?: FactorLanguage;
      runtimeVersion?: 'ts-v1' | 'py-v1';
    }
  | { kind: 'macro_regime'; label: string; code: string };

const factorAnalysisRuntimeSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('single'),
    code: z.string().min(1),
    label: z.string().min(1),
    language: z.enum(['typescript', 'python']).optional(),
    runtimeVersion: z.enum(['ts-v1', 'py-v1']).optional(),
  }),
  z.object({
    kind: z.literal('time_series'),
    label: z.string().min(1),
    code: z.string().min(1),
    language: z.enum(['typescript', 'python']).optional(),
    runtimeVersion: z.enum(['ts-v1', 'py-v1']).optional(),
  }),
  z.object({
    kind: z.literal('panel'),
    label: z.string().min(1),
    code: z.string().min(1),
    language: z.enum(['typescript', 'python']).optional(),
    runtimeVersion: z.enum(['ts-v1', 'py-v1']).optional(),
  }),
  z.object({
    kind: z.literal('macro_regime'),
    label: z.string().min(1),
    code: z.string().min(1),
  }),
  z.object({
    kind: z.literal('panel_composite'),
    label: z.string().min(1),
    definition: factorPanelCompositeDefinitionV2Schema,
    components: z
      .array(
        z.object({
          factor: z.string().min(1),
          code: z.string().min(1),
          label: z.string().min(1),
          direction: z.enum(['positive', 'negative']),
          language: z.enum(['typescript', 'python']).optional(),
          runtimeVersion: z.enum(['ts-v1', 'py-v1']).optional(),
        }),
      )
      .min(2)
      .max(5),
  }),
  z.object({
    kind: z.literal('composite'),
    label: z.string().min(1),
    definition: factorCompositeDefinitionV1Schema,
    components: z
      .array(
        z.object({
          factor: z.string().min(1),
          code: z.string().min(1),
          label: z.string().min(1),
          direction: z.enum(['positive', 'negative']),
          language: z.enum(['typescript', 'python']).optional(),
          runtimeVersion: z.enum(['ts-v1', 'py-v1']).optional(),
        }),
      )
      .min(2)
      .max(5),
  }),
]);

export function factorAnalysisSourceSnapshot(source: FactorAnalysisSource): string {
  return source.kind === 'single' ||
    source.kind === 'time_series' ||
    source.kind === 'panel' ||
    source.kind === 'macro_regime'
    ? source.code
    : canonicalJson(source);
}

export function parseFactorAnalysisSourceSnapshot(
  snapshot: string,
  label: string,
  composite: boolean,
  language: FactorLanguage = 'typescript',
): FactorAnalysisSource {
  if (!composite) {
    return {
      kind: 'single',
      code: snapshot,
      label,
      language,
      runtimeVersion: factorRuntimeVersion(language),
    };
  }
  return factorAnalysisRuntimeSourceSchema.parse(JSON.parse(snapshot));
}

export function parseAssetFactorAnalysisSourceSnapshot(
  snapshot: string,
  label: string,
  analysisKind: 'time_series' | 'panel' | 'macro_regime',
  language: FactorLanguage = 'typescript',
): FactorAnalysisSource {
  if (analysisKind === 'panel') {
    try {
      const parsed = factorAnalysisRuntimeSourceSchema.parse(JSON.parse(snapshot));
      if (parsed.kind === 'panel_composite') {
        return parsed;
      }
    } catch {
      // Plain Factor V2 code is not JSON and remains the compatibility path.
    }
  }
  return analysisKind === 'macro_regime'
    ? { kind: analysisKind, code: snapshot, label }
    : {
        kind: analysisKind,
        code: snapshot,
        label,
        language,
        runtimeVersion: factorRuntimeVersion(language),
      };
}

export async function startFactorAnalysis(options: {
  userId: string;
  factor: string;
  source: FactorAnalysisSource;
  spec: FactorAnalysisSpec | FactorResearchSpecV1;
  researchIntent: FactorResearchIntentV1;
  parentReportId?: string | null;
  locale: Locale;
  failedMessage: string;
  exitedMessage: (code: number) => string;
  launchWorker?: (options: {
    reportId: string;
    jobId: string;
    factor: string;
    source: FactorAnalysisSource;
    spec: FactorResearchSpecV1;
    locale: Locale;
    failedMessage: string;
    exitedMessage: (code: number) => string;
  }) => Promise<void>;
}): Promise<RunFactorAnalysisResponse> {
  const factorCodeSnapshot = factorAnalysisSourceSnapshot(options.source);
  const language = factorAnalysisSourceLanguage(options.source);
  const runtimeVersion = factorRuntimeVersion(language);
  const factorCodeHash = factorAnalysisSourceHash(factorCodeSnapshot, language);
  const dataRevision = null;
  const researchSpec = normalizeFactorResearchSpec(options.spec);
  const identitySpec =
    researchSpec.analysisKind === 'cross_sectional' ? researchSpec.protocol : researchSpec;
  const variantKey = factorVariantKey(identitySpec, factorCodeHash, dataRevision);
  const testKey = factorTestKey(identitySpec, factorCodeHash, options.researchIntent);
  const reportColumns = reportCompatibilityColumns(researchSpec);
  const reportId = ulid();
  const jobId = ulid();
  const created = await prisma.$transaction(async (transaction) => {
    const running = await transaction.factorReport.findFirst({
      where: {
        userId: options.userId,
        factor: options.factor,
        variantKey,
        testKey,
        status: 'running',
      },
      include: { job: { select: { id: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    });
    if (running?.job && ACTIVE_JOB_STATUSES.includes(running.job.status as 'queued' | 'running')) {
      return { reportId: running.id, jobId: running.job.id, reusedRunning: true };
    }
    if (running) {
      await transaction.factorReport.update({
        where: { id: running.id },
        data: { status: 'stale' },
      });
    }

    await transaction.factorReport.create({
      data: {
        id: reportId,
        userId: options.userId,
        factor: options.factor,
        status: 'running',
        phase: 'explore',
        ...reportColumns,
        analysisKind: researchSpec.analysisKind,
        specJson: JSON.stringify(researchSpec),
        variantKey,
        factorCodeSnapshot,
        factorCodeHash,
        language,
        runtimeVersion,
        dataRevision,
        parentReportId: options.parentReportId ?? null,
        testKey,
        researchIntentJson: JSON.stringify(options.researchIntent),
        job: {
          create: {
            id: jobId,
            userId: options.userId,
            kind: 'factor',
            key: variantKey,
            status: 'queued',
            payload: factorJobPayload({
              task: 'analysis',
              reportId,
              factor: options.factor,
              source: options.source,
              spec: researchSpec,
              locale: options.locale,
              failedMessage: options.failedMessage,
            }),
          },
        },
      },
    });

    return { reportId, jobId, reusedRunning: false };
  });
  const response: RunFactorAnalysisResponse = { ...created, status: 'running' };
  if (created.reusedRunning) {
    return response;
  }

  initializeJobLogs(jobId);
  if (options.launchWorker) {
    await options.launchWorker({
      reportId,
      jobId,
      factor: options.factor,
      source: options.source,
      spec: researchSpec,
      locale: options.locale,
      failedMessage: options.failedMessage,
      exitedMessage: options.exitedMessage,
    });
  } else {
    wakeJobQueue();
  }
  return response;
}

export function factorAnalysisSourceHash(snapshot: string, language: FactorLanguage): string {
  return sha256(language === 'python' ? `py-v1\0${snapshot}` : snapshot);
}

function factorAnalysisSourceLanguage(source: FactorAnalysisSource): FactorLanguage {
  if (source.kind === 'single' || source.kind === 'time_series' || source.kind === 'panel') {
    return source.language === 'python' ? 'python' : 'typescript';
  }
  return 'typescript';
}

interface FactorJobPayload {
  task: 'analysis';
  reportId: string;
  factor: string;
  source: FactorAnalysisSource;
  spec: FactorResearchSpecV1;
  locale: Locale;
  failedMessage: string;
}

function factorJobPayload(input: FactorJobPayload): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify({ ...input, task: 'analysis' })) as Prisma.InputJsonValue;
}

export const factorAnalysisJob = defineJob({
  parse(raw, job): FactorJobPayload {
    const payload = z.record(z.string(), z.unknown()).parse(raw);
    if (payload.task !== 'analysis') {
      throw new Error('Factor analysis job payload has an invalid task');
    }
    const input: FactorJobPayload = {
      task: 'analysis',
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

function reportCompatibilityColumns(researchSpec: FactorResearchSpecV1): {
  freq: string;
  neutral: string;
  start: string;
  end: string;
} {
  if (researchSpec.analysisKind === 'cross_sectional') {
    return {
      freq: researchSpec.protocol.freq,
      neutral: researchSpec.protocol.neutral,
      start: researchSpec.protocol.start,
      end: researchSpec.protocol.end,
    };
  }
  const frequency = { daily: 'day', weekly: 'week', monthly: 'month' } as const;
  return {
    freq: frequency[researchSpec.observationFrequency],
    neutral: 'none',
    start: researchSpec.start,
    end: researchSpec.end,
  };
}

export async function readFactorAnalysisResult(
  userId: string,
  reportId: string,
): Promise<{
  status: 'running' | 'done' | 'error' | 'stale';
  error?: string;
  payload?: FactorReport;
} | null> {
  const row = await prisma.factorReport.findFirst({
    where: { id: reportId, userId, phase: 'explore' },
    select: { status: true, error: true, payload: true },
  });
  if (!row) {
    return null;
  }

  const status = ['running', 'done', 'error', 'stale'].includes(row.status)
    ? (row.status as 'running' | 'done' | 'error' | 'stale')
    : 'error';
  let payload: FactorReport | undefined;
  if (row.payload) {
    try {
      payload = JSON.parse(row.payload) as FactorReport;
    } catch {
      return { status: 'error', error: 'Factor report payload is invalid.' };
    }
  }
  return { status, error: row.error ?? undefined, payload };
}
