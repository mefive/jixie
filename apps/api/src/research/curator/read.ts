import { researchCuratorRunState } from '#research/curator/state.js';
import { prisma } from '#infra/database/prisma.js';
import type { ResearchCuratorQualityMetricsV1, ResearchCuratorRunV1 } from '@jixie/shared';
import type { PrismaClient } from '@prisma/client';
import { ResearchError } from '../errors.js';
import { curatorRunRecord } from './views.js';

const MINIMUM_REVIEWED_FINDINGS = 20;
const MINIMUM_VERIFICATION_ASSESSMENTS = 20;

export async function getLatestResearchCuratorRun(
  userId: string,
  database: PrismaClient = prisma,
): Promise<ResearchCuratorRunV1 | null> {
  const run = await database.researchCuratorRun
    .findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { job: true, findings: { orderBy: { createdAt: 'asc' } } },
    })
    .then((row) => (row ? researchCuratorRunState(row) : row));
  return run ? curatorRunRecord(run, await researchCuratorQuality(userId, database)) : null;
}

export async function getResearchCuratorRun(
  userId: string,
  runId: string,
  database: PrismaClient = prisma,
): Promise<ResearchCuratorRunV1> {
  const run = await database.researchCuratorRun
    .findFirst({
      where: { id: runId, userId },
      include: { job: true, findings: { orderBy: { createdAt: 'asc' } } },
    })
    .then((row) => (row ? researchCuratorRunState(row) : row));
  if (!run) {
    throw new ResearchError('curator_run_not_found');
  }
  return curatorRunRecord(run, await researchCuratorQuality(userId, database));
}

export async function researchCuratorQuality(
  userId: string,
  database: PrismaClient = prisma,
): Promise<ResearchCuratorQualityMetricsV1> {
  const [findings, runTotals] = await Promise.all([
    database.researchCuratorFinding.findMany({
      where: { userId },
      select: { disposition: true, verificationAssessment: true },
    }),
    database.researchCuratorRun.aggregate({
      where: { userId },
      _sum: { duplicatesSkipped: true },
    }),
  ]);
  const countDisposition = (value: string) =>
    findings.filter((finding) => finding.disposition === value).length;
  const accepted = countDisposition('accepted');
  const rejected = countDisposition('rejected');
  const duplicates = countDisposition('duplicate');
  const reviewed = accepted + rejected;
  const duplicatesSkipped = runTotals._sum.duplicatesSkipped ?? 0;
  const verificationAssessments = findings.filter(
    (finding) => finding.verificationAssessment !== null,
  ).length;
  const verificationErrors = findings.filter(
    (finding) => finding.verificationAssessment === 'incorrect',
  ).length;
  return {
    totalFindings: findings.length,
    pending: countDisposition('pending'),
    deferred: countDisposition('deferred'),
    reviewed,
    accepted,
    rejected,
    duplicates,
    duplicatesSkipped,
    acceptanceRate: reviewed > 0 ? accepted / reviewed : null,
    duplicateRate:
      findings.length + duplicatesSkipped > 0
        ? (duplicates + duplicatesSkipped) / (findings.length + duplicatesSkipped)
        : null,
    verificationAssessments,
    verificationErrors,
    verificationErrorRate:
      verificationAssessments > 0 ? verificationErrors / verificationAssessments : null,
    evaluationReady:
      reviewed >= MINIMUM_REVIEWED_FINDINGS &&
      verificationAssessments >= MINIMUM_VERIFICATION_ASSESSMENTS,
    minimumReviewedFindings: MINIMUM_REVIEWED_FINDINGS,
    minimumVerificationAssessments: MINIMUM_VERIFICATION_ASSESSMENTS,
  };
}
