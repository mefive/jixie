import { prisma } from '#infra/database/prisma.js';
import type { ResearchCuratorDispositionV1, ResearchCuratorFindingV1 } from '@jixie/shared';
import type { PrismaClient } from '@prisma/client';
import { ResearchError } from '../errors.js';
import type { ResearchCuratorFindingUpdateInput } from '@jixie/shared/api/research';
import { curatorFindingRecord } from './views.js';

/**
 * 按归属更新 Curator 发现的处理状态，保留人工反馈。
 * Update an owned curator finding's disposition with user feedback.
 */
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

/**
 * 保存 Curator 发现反馈，供后续整理与质量判断。
 * Persist feedback on a curator finding for later curation and quality assessment.
 */
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
