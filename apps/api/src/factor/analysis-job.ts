import { Worker } from 'node:worker_threads';
import type {
  FactorLanguage,
  FactorAnalysisSpec,
  FactorReport,
  FactorResearchIntentV1,
  FactorResearchSpecV1,
  Locale,
  LogLine,
  RunFactorAnalysisResponse,
} from '@jixie/shared';
import { factorRuntimeVersion } from '@jixie/shared';
import { ulid } from 'ulid';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import {
  ACTIVE_JOB_STATUSES,
  appendLog,
  finishFactorReportJob,
  initializeJobLogs,
} from '../lib/jobs.js';
import { wakeJobQueue } from '../lib/job-queue.js';
import { prisma } from '../lib/prisma.js';
import { t } from '../i18n/messages.js';
import {
  canonicalJson,
  factorCompositeDefinitionV1Schema,
  factorPanelCompositeDefinitionV2Schema,
  factorTestKey,
  factorVariantKey,
  normalizeFactorResearchSpec,
  sha256,
} from './report-spec.js';
import type { FactorAnalysisRuntimeSource } from './composite.js';

const workerUrl = import.meta.url.endsWith('.ts')
  ? new URL('./factor-worker.boot.mjs', import.meta.url)
  : new URL('./factor-worker.js', import.meta.url);

export type FactorAnalysisSource =
  | FactorAnalysisRuntimeSource
  | { kind: 'time_series'; label: string; code: string }
  | { kind: 'panel'; label: string; code: string }
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
  }),
  z.object({
    kind: z.literal('panel'),
    label: z.string().min(1),
    code: z.string().min(1),
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
): FactorAnalysisSource {
  if (!composite) {
    return { kind: 'single', code: snapshot, label };
  }
  return factorAnalysisRuntimeSourceSchema.parse(JSON.parse(snapshot));
}

export function parseAssetFactorAnalysisSourceSnapshot(
  snapshot: string,
  label: string,
  analysisKind: 'time_series' | 'panel' | 'macro_regime',
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
  return { kind: analysisKind, code: snapshot, label };
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
  launchWorker?: typeof launchFactorWorker;
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
  if (source.kind === 'single') {
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

/** Reconstruct and execute a durable factor-analysis Job claimed by the shared scheduler. */
export async function runFactorAnalysisJob(
  jobId: string,
  rawPayload: Record<string, unknown>,
): Promise<void> {
  if (rawPayload.task !== 'analysis') {
    throw new Error('Factor analysis job payload has an invalid task');
  }
  const source = factorAnalysisRuntimeSourceSchema.parse(rawPayload.source);
  const spec = normalizeFactorResearchSpec(rawPayload.spec);
  const locale = z.enum(['zh', 'en']).parse(rawPayload.locale);
  const reportId = z.string().min(1).parse(rawPayload.reportId);
  const factor = z.string().min(1).parse(rawPayload.factor);
  const failedMessage = z.string().min(1).parse(rawPayload.failedMessage);
  await launchFactorWorker({
    reportId,
    jobId,
    factor,
    source,
    spec,
    locale,
    failedMessage,
    exitedMessage: (code) => t(locale, 'factorProcExited', { code }),
  });
}

export async function launchFactorWorker(options: {
  reportId: string;
  jobId: string;
  factor: string;
  source: FactorAnalysisSource;
  spec: FactorResearchSpecV1;
  locale: Locale;
  failedMessage: string;
  exitedMessage: (code: number) => string;
}): Promise<void> {
  initializeJobLogs(options.jobId);
  await new Promise<void>((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(workerUrl, {
        workerData: {
          reportId: options.reportId,
          factor: options.factor,
          source: options.source,
          spec: options.spec,
          locale: options.locale,
        },
      });
    } catch (error) {
      void finishFactorReportJob(
        options.jobId,
        options.reportId,
        'error',
        undefined,
        error instanceof Error ? error.message : String(error),
        options.failedMessage,
      ).finally(resolve);
      return;
    }
    let finished = false;
    const done = async (status: 'done' | 'error', payload?: string, error?: string) => {
      if (finished) {
        return;
      }
      finished = true;
      await finishFactorReportJob(
        options.jobId,
        options.reportId,
        status,
        payload,
        error,
        status === 'error' ? options.failedMessage : undefined,
      ).catch((finishError) => {
        console.error('[jixie] failed to finalize factor report', finishError);
      });
      resolve();
    };
    worker.on(
      'message',
      (message: { type: string; entry?: LogLine; message?: string; payload?: string }) => {
        switch (message.type) {
          case 'log':
            appendLog(options.jobId, message.entry!);
            break;
          case 'done':
            void done('done', message.payload);
            break;
          case 'error':
            void done('error', undefined, message.message);
            break;
        }
      },
    );
    worker.on('error', (error) => void done('error', undefined, error.message));
    worker.on('exit', (code) => {
      if (code !== 0) {
        void done('error', undefined, options.exitedMessage(code));
      } else if (!finished) {
        void done('error', undefined, options.exitedMessage(code));
      }
    });
  });
}

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
