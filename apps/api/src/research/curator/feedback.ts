import type { PrismaClient } from '@prisma/client';
import type {
  ResearchCuratorDispositionV1,
  ResearchCuratorFindingV1,
  ResearchCuratorVerificationAssessmentV1,
} from '@jixie/shared';
import { prisma } from '#infra/database/prisma.js';
import { curatorFindingRecord } from './views.js';

export async function setResearchCuratorFindingDisposition(
  userId: string,
  findingId: string,
  disposition: ResearchCuratorDispositionV1,
  note: string | undefined,
  database: PrismaClient = prisma,
): Promise<ResearchCuratorFindingV1 | null> {
  const existing = await database.researchCuratorFinding.findFirst({
    where: { id: findingId, userId },
    select: { id: true },
  });
  if (!existing || disposition === 'pending') {
    return null;
  }
  const finding = await database.researchCuratorFinding.update({
    where: { id: findingId },
    data: {
      disposition,
      dispositionNote: note || null,
      disposedAt: new Date(),
    },
  });
  return curatorFindingRecord(finding);
}

export async function updateResearchCuratorFindingFeedback(
  userId: string,
  findingId: string,
  input: {
    disposition?: Exclude<ResearchCuratorDispositionV1, 'pending'>;
    note?: string;
    verificationAssessment?: ResearchCuratorVerificationAssessmentV1;
  },
  database: PrismaClient = prisma,
): Promise<ResearchCuratorFindingV1 | null> {
  const existing = await database.researchCuratorFinding.findFirst({
    where: { id: findingId, userId },
    select: { id: true },
  });
  if (!existing) {
    return null;
  }
  const now = new Date();
  const finding = await database.researchCuratorFinding.update({
    where: { id: findingId },
    data: {
      ...(input.disposition
        ? {
            disposition: input.disposition,
            dispositionNote: input.note || null,
            disposedAt: now,
          }
        : {}),
      ...(input.verificationAssessment
        ? {
            verificationAssessment: input.verificationAssessment,
            verificationAssessedAt: now,
          }
        : {}),
    },
  });
  return curatorFindingRecord(finding);
}
