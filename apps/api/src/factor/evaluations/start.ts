import { factorReportStatusWhere, factorReportState } from '#factor/evaluations/state.js';
import { getDatabase } from '#infra/database/prisma.js';
import { JobScheduler } from '#jobs/job-scheduler.js';
import { ACTIVE_JOB_STATUSES } from '#jobs/job-service.js';
import {
  type FactorAnalysisSpec,
  type FactorResearchSpecV1,
  type Locale,
  type RunFactorAnalysisResponse,
  factorRuntimeVersion,
} from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { normalizeFactorResearchSpec } from '../analysis/spec.js';
import {
  type FactorAnalysisSource,
  factorAnalysisSourceHash,
  factorAnalysisSourceLanguage,
  factorAnalysisSourceSnapshot,
} from '../sources/snapshot.js';
import { factorVariantKey } from './identity.js';
import type { FactorAnalysisJobPayload } from './job-payload.js';
import { reportCompatibilityColumns } from './report-spec.js';

/**
 * 建立因子分析记录及任务关联，供后台评估运行。
 *
 * Create factor-analysis records and job associations for background evaluation.
 */
export async function startFactorAnalysis(options: {
  userId: string;
  factor: string;
  source: FactorAnalysisSource;
  spec: FactorAnalysisSpec | FactorResearchSpecV1;
  locale: Locale;
  failedMessage: string;
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
  const reportColumns = reportCompatibilityColumns(researchSpec);
  const reportId = ulid();
  const jobId = ulid();
  const created = await getDatabase().$transaction(async (transaction) => {
    const running = await transaction.factorReport
      .findFirst({
        where: {
          userId: options.userId,
          factor: options.factor,
          variantKey,
          AND: [factorReportStatusWhere(['running'])],
        },
        include: { job: true },
        orderBy: { createdAt: 'desc' },
      })
      .then((row) => (row ? factorReportState(row) : row));
    if (running?.job && ACTIVE_JOB_STATUSES.includes(running.job.status as 'queued' | 'running')) {
      return { reportId: running.id, jobId: running.job.id, reusedRunning: true };
    }

    await transaction.factorReport.create({
      data: {
        id: reportId,
        userId: options.userId,
        factor: options.factor,
        legacyStatus: null,
        failureMessage: null,
        ...reportColumns,
        analysisKind: researchSpec.analysisKind,
        specJson: JSON.stringify(researchSpec),
        variantKey,
        factorCodeSnapshot,
        factorCodeHash,
        language,
        runtimeVersion,
        dataRevision,
        job: {
          create: {
            id: jobId,
            userId: options.userId,
            kind: 'factor-analysis',
            key: variantKey,
            status: 'queued',
            payload: factorAnalysisJobPayload({
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

  JobScheduler.wake();
  return response;
}

function factorAnalysisJobPayload(input: FactorAnalysisJobPayload): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue;
}
