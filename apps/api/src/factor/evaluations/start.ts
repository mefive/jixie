import { prisma } from '#infra/database/prisma.js';
import { initializeJobLogs } from '#infra/jobs/logs.js';
import { wakeJobQueue } from '#infra/jobs/queue.js';
import { ACTIVE_JOB_STATUSES } from '#infra/jobs/records.js';
import {
  type FactorAnalysisSpec,
  type FactorResearchIntentV1,
  type FactorResearchSpecV1,
  type Locale,
  type RunFactorAnalysisResponse,
  factorRuntimeVersion,
} from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { normalizeFactorResearchSpec } from '../execution/spec.js';
import {
  type FactorAnalysisSource,
  factorAnalysisSourceHash,
  factorAnalysisSourceLanguage,
  factorAnalysisSourceSnapshot,
} from '../sources/snapshot.js';
import { factorTestKey, factorVariantKey } from './identity.js';
import type { FactorJobPayload } from './job.js';

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

function factorJobPayload(input: FactorJobPayload): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify({ ...input, task: 'analysis' })) as Prisma.InputJsonValue;
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
