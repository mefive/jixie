import { prisma } from '#infra/database/prisma.js';
import { ResearchError } from '../errors.js';

export async function assertNoOpenCellChangeReview(documentId: string): Promise<void> {
  const review = await prisma.researchCellChangeProposal.findFirst({
    where: { documentId, reviewStatus: 'open' },
    select: { id: true },
  });
  if (review) {
    throw new ResearchError('cell_change_review_open');
  }
}
