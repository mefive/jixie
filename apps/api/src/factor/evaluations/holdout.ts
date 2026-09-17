import { t } from '#i18n/index.js';
import { prisma } from '#infra/database/prisma.js';
import { initializeJobLogs } from '#infra/jobs/logs.js';
import { wakeJobQueue } from '#infra/jobs/queue.js';
import type { FactorResearchSpecV1, Locale, RunFactorAnalysisResponse } from '@jixie/shared';
import { ulid } from 'ulid';
import { FactorError } from '../errors.js';
import { normalizeFactorAnalysisSpec } from '../execution/spec.js';
import { resolveAssetFactorDataCutoff } from '../observations/asset-factor-data-cutoff.js';
import { factorCodeDataRequirements } from '../sources/resolve.js';
import {
  parseAssetFactorAnalysisSourceSnapshot,
  parseFactorAnalysisSourceSnapshot,
} from '../sources/snapshot.js';
import { holdoutEligibility } from './holdout-policy.js';
import { factorVariantKey } from './identity.js';
import { reportCompatibilityColumns, reportResearchSpec } from './report-spec.js';
import { parseReportPayload, parseResearchPayload, reportSummary } from './report-views.js';
import { parseResearchIntent } from './research-policy.js';

export async function submitFactorHoldout(userId: string, parentReportId: string, locale: Locale) {
  const parent = await prisma.factorReport.findFirst({
    where: { id: parentReportId, userId },
  });

  if (!parent) {
    throw new FactorError('evaluation_not_found');
  }

  const eligibility = await holdoutEligibility(parent);

  if (!eligibility.eligible) {
    if (eligibility.existingReportId) {
      const existing = await prisma.factorReport.findUnique({
        where: { id: eligibility.existingReportId },
        include: { job: { select: { id: true } } },
      });
      if (existing?.job) {
        return {
          reportId: existing.id,
          jobId: existing.job.id,
          status: 'running',
          reusedRunning: true,
        } satisfies RunFactorAnalysisResponse;
      }
    }
    throw new FactorError('holdout_unavailable', {
      details: {
        reason: eligibility.reason,
      },
    });
  }

  const policy = eligibility.window!;
  const parentResearchSpec = reportResearchSpec(parent);
  let researchSpec: FactorResearchSpecV1;

  if (parentResearchSpec.analysisKind === 'cross_sectional') {
    researchSpec = {
      version: 1,
      analysisKind: 'cross_sectional',
      protocol: normalizeFactorAnalysisSpec({
        ...parentResearchSpec.protocol,
        start: policy.holdoutStart,
        end: policy.holdoutEnd,
      }),
    };
  } else if (
    parentResearchSpec.analysisKind === 'time_series' ||
    parentResearchSpec.analysisKind === 'panel'
  ) {
    const candidate = {
      ...parentResearchSpec,
      start: policy.holdoutStart,
      end: policy.holdoutEnd,
      dataPolicy: { ...parentResearchSpec.dataPolicy, dataCutoff: policy.holdoutEnd },
    };
    const dataCutoff = await resolveAssetFactorDataCutoff(
      candidate,
      factorCodeDataRequirements(parent.factorCodeSnapshot ?? ''),
    );
    if (!dataCutoff) {
      throw new FactorError('holdout_unavailable');
    }
    researchSpec = {
      ...candidate,
      dataPolicy: { ...candidate.dataPolicy, dataCutoff },
    };
  } else {
    throw new FactorError('factor_analysis_kind_unsupported', {
      params: { kind: parentResearchSpec.analysisKind },
    });
  }

  // Holdout repeats the explored snapshot, even if the editable definition has changed.
  const factorCodeSnapshot = parent.factorCodeSnapshot!;
  const factorCodeHash = parent.factorCodeHash!;
  const identitySpec =
    researchSpec.analysisKind === 'cross_sectional' ? researchSpec.protocol : researchSpec;
  const variantKey = factorVariantKey(identitySpec, factorCodeHash, parent.dataRevision);
  const columns = reportCompatibilityColumns(researchSpec);
  const source =
    researchSpec.analysisKind === 'time_series' || researchSpec.analysisKind === 'panel'
      ? parseAssetFactorAnalysisSourceSnapshot(
          factorCodeSnapshot,
          parent.factor,
          researchSpec.analysisKind,
          parent.language === 'python' ? 'python' : 'typescript',
        )
      : parseFactorAnalysisSourceSnapshot(
          factorCodeSnapshot,
          parseReportPayload(parent.payload)?.label ?? parent.factor,
          researchSpec.protocol.version === 4 ||
            (researchSpec.protocol.version === 6 && !!researchSpec.protocol.composite),
          parent.language === 'python' ? 'python' : 'typescript',
        );
  const reportId = ulid();
  const jobId = ulid();
  // Recheck inside the transaction and persist the report and queued job together.
  const created = await prisma.$transaction(async (transaction) => {
    const existing = await transaction.factorReport.findFirst({
      where: {
        userId,
        parentReportId: parent.id,
        phase: 'holdout',
        status: { in: ['running', 'done'] },
      },
      include: { job: { select: { id: true } } },
    });
    if (existing?.job) {
      return { reportId: existing.id, jobId: existing.job.id, reusedRunning: true };
    }
    await transaction.factorReport.create({
      data: {
        id: reportId,
        userId,
        factor: parent.factor,
        status: 'running',
        phase: 'holdout',
        ...columns,
        analysisKind: researchSpec.analysisKind,
        specJson: JSON.stringify(researchSpec),
        variantKey,
        factorCodeSnapshot,
        factorCodeHash,
        language: parent.language,
        runtimeVersion: parent.runtimeVersion,
        dataRevision: parent.dataRevision,
        parentReportId: parent.id,
        testKey: parent.testKey,
        researchIntentJson: parent.researchIntentJson,
        holdoutPolicyJson: JSON.stringify(policy),
        job: {
          create: {
            id: jobId,
            userId,
            kind: 'factor-analysis',
            key: variantKey,
            status: 'queued',
            payload: JSON.parse(
              JSON.stringify({
                reportId,
                factor: parent.factor,
                source,
                spec: researchSpec,
                locale,
                failedMessage: t(locale, 'factorAnalysisFailed'),
              }),
            ),
          },
        },
      },
    });
    return { reportId, jobId, reusedRunning: false };
  });
  const response: RunFactorAnalysisResponse = { ...created, status: 'running' };

  // The queue may observe the job only after its report has committed.
  if (!created.reusedRunning) {
    initializeJobLogs(jobId);
    wakeJobQueue();
  }

  return response;
}

export async function revealFactorHoldout(userId: string, reportId: string) {
  const report = await prisma.factorReport.findFirst({
    where: { id: reportId, userId },
  });

  if (!report) {
    throw new FactorError('evaluation_not_found');
  }
  if (report.phase !== 'holdout' || report.status !== 'done') {
    throw new FactorError('holdout_unavailable');
  }

  if (!report.revealedAt) {
    await prisma.factorReport.updateMany({
      where: { id: reportId, userId, revealedAt: null },
      data: { revealedAt: new Date() },
    });
  }

  const revealed = await prisma.factorReport.findUniqueOrThrow({
    where: { id: reportId },
    include: { job: { select: { id: true } } },
  });
  const researchSpec = reportResearchSpec(revealed);
  const researchPayload = parseResearchPayload(revealed.payload, researchSpec);

  return {
    ...reportSummary(revealed),
    payload:
      researchPayload?.analysisKind === 'cross_sectional' ? researchPayload.report : undefined,
    researchPayload,
    factorCodeSnapshot: revealed.factorCodeSnapshot ?? undefined,
    factorCodeHash: revealed.factorCodeHash ?? undefined,
    dataRevision: revealed.dataRevision ?? undefined,
    parentReportId: revealed.parentReportId ?? undefined,
    researchIntent: parseResearchIntent(revealed.researchIntentJson),
    canReveal: false,
  };
}
