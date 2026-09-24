import type { Prisma } from '@prisma/client';
import type {
  ResearchCuratorFindingV1,
  ResearchCuratorQualityMetricsV1,
  ResearchCuratorRunV1,
  ResearchCuratorVerificationAssessmentV1,
} from '@jixie/shared';

type CuratorRunWithRelations = Prisma.ResearchCuratorRunGetPayload<{
  include: { job: { select: { id: true } }; findings: true };
}>;

type CuratorFindingRecord = Prisma.ResearchCuratorFindingGetPayload<object>;

export function curatorRunRecord(
  run: CuratorRunWithRelations & { status: string; error: string | null },
  quality: ResearchCuratorQualityMetricsV1,
): ResearchCuratorRunV1 {
  return {
    version: 1,
    id: run.id,
    ...(run.job?.id ? { jobId: run.job.id } : {}),
    status: run.status as ResearchCuratorRunV1['status'],
    trigger: run.trigger as ResearchCuratorRunV1['trigger'],
    ...(run.cursorFrom ? { cursorFrom: run.cursorFrom.toISOString() } : {}),
    cursorTo: run.cursorTo.toISOString(),
    evidenceCount: run.evidenceCount,
    findingsCreated: run.findingsCreated,
    duplicatesSkipped: run.duplicatesSkipped,
    quality,
    ...(run.error ? { error: run.error } : {}),
    findings: run.findings.map(curatorFindingRecord),
    createdAt: run.createdAt.toISOString(),
  };
}

export function curatorFindingRecord(finding: CuratorFindingRecord): ResearchCuratorFindingV1 {
  const persistedVerification = finding.verification as unknown as Partial<
    ResearchCuratorFindingV1['verification']
  >;
  return {
    version: 1,
    id: finding.id,
    runId: finding.runId,
    category: finding.category as ResearchCuratorFindingV1['category'],
    title: finding.title,
    summary: finding.summary,
    evidence: finding.evidence as unknown as ResearchCuratorFindingV1['evidence'],
    verification: {
      status: persistedVerification.status ?? 'unverified',
      matches: Array.isArray(persistedVerification.matches) ? persistedVerification.matches : [],
      notes: Array.isArray(persistedVerification.notes) ? persistedVerification.notes : [],
      evidence: Array.isArray(persistedVerification.evidence) ? persistedVerification.evidence : [],
    },
    confidence: finding.confidence,
    expectedValue: finding.expectedValue,
    changeSurface: finding.changeSurface as unknown as ResearchCuratorFindingV1['changeSurface'],
    suggestedAction: finding.suggestedAction,
    fingerprint: finding.fingerprint,
    disposition: finding.disposition as ResearchCuratorFindingV1['disposition'],
    ...(finding.dispositionNote ? { dispositionNote: finding.dispositionNote } : {}),
    ...(finding.disposedAt ? { disposedAt: finding.disposedAt.toISOString() } : {}),
    ...(finding.verificationAssessment
      ? {
          verificationAssessment:
            finding.verificationAssessment as ResearchCuratorVerificationAssessmentV1,
        }
      : {}),
    ...(finding.verificationAssessedAt
      ? { verificationAssessedAt: finding.verificationAssessedAt.toISOString() }
      : {}),
    createdAt: finding.createdAt.toISOString(),
  };
}
