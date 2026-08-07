import { Worker } from 'node:worker_threads';
import type {
  FactorAnalysisSpec,
  FactorReport,
  FactorResearchIntentV1,
  FactorResearchSpecV1,
  Locale,
  LogLine,
  RunFactorAnalysisResponse,
} from '@jixie/shared';
import { ulid } from 'ulid';
import { z } from 'zod';
import { appendLog, finishFactorReportJob, initializeJobLogs } from '../lib/jobs.js';
import { prisma } from '../lib/prisma.js';
import {
  canonicalJson,
  factorCompositeDefinitionV1Schema,
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
  | { kind: 'time_series'; label: string; code: string };

const factorAnalysisRuntimeSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('single'), code: z.string().min(1), label: z.string().min(1) }),
  z.object({
    kind: z.literal('time_series'),
    label: z.string().min(1),
    code: z.string().min(1),
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
        }),
      )
      .min(2)
      .max(5),
  }),
]);

export function factorAnalysisSourceSnapshot(source: FactorAnalysisSource): string {
  return source.kind === 'single' || source.kind === 'time_series'
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
  const factorCodeHash = sha256(factorCodeSnapshot);
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
    if (running?.job?.status === 'running') {
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
            status: 'running',
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

  await (options.launchWorker ?? launchFactorWorker)({
    reportId,
    jobId,
    factor: options.factor,
    source: options.source,
    spec: researchSpec,
    locale: options.locale,
    failedMessage: options.failedMessage,
    exitedMessage: options.exitedMessage,
  });
  return response;
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
    await finishFactorReportJob(
      options.jobId,
      options.reportId,
      'error',
      undefined,
      error instanceof Error ? error.message : String(error),
      options.failedMessage,
    );
    return;
  }
  let finished = false;
  const done = (status: 'done' | 'error', payload?: string, error?: string) => {
    if (finished) {
      return;
    }
    finished = true;
    void finishFactorReportJob(
      options.jobId,
      options.reportId,
      status,
      payload,
      error,
      status === 'error' ? options.failedMessage : undefined,
    ).catch((finishError) => {
      console.error('[jixie] failed to finalize factor report', finishError);
    });
  };
  worker.on(
    'message',
    (message: { type: string; entry?: LogLine; message?: string; payload?: string }) => {
      switch (message.type) {
        case 'log':
          appendLog(options.jobId, message.entry!);
          break;
        case 'done':
          done('done', message.payload);
          break;
        case 'error':
          done('error', undefined, message.message);
          break;
      }
    },
  );
  worker.on('error', (error) => done('error', undefined, error.message));
  worker.on('exit', (code) => {
    if (code !== 0) {
      done('error', undefined, options.exitedMessage(code));
    }
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
