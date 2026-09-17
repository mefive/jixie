import { prisma } from '#infra/database/prisma.js';
import type { ResearchCuratorDispositionV1, ResearchCuratorFindingV1 } from '@jixie/shared';
import type { PrismaClient } from '@prisma/client';
import { ResearchError } from '../errors.js';
import type { ResearchCuratorFindingUpdateInput } from '@jixie/shared/api/research';
import { curatorFindingRecord } from './views.js';

export async function setResearchCuratorFindingDisposition(
  userId: string,
  findingId: string,
  disposition: ResearchCuratorDispositionV1,
  note: string | undefined,
  database: PrismaClient = prisma,
): Promise<ResearchCuratorFindingV1> {
  const existing = await database.researchCuratorFinding.findFirst({
    where: { id: findingId, userId },
    select: { id: true },
  });
  if (!existing) {
    throw new ResearchError('curator_finding_not_found');
  }
  if (disposition === 'pending') {
    throw new ResearchError('curator_disposition_invalid');
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
  input: ResearchCuratorFindingUpdateInput,
  database: PrismaClient = prisma,
): Promise<ResearchCuratorFindingV1> {
  const existing = await database.researchCuratorFinding.findFirst({
    where: { id: findingId, userId },
    select: { id: true },
  });
  if (!existing) {
    throw new ResearchError('curator_finding_not_found');
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
