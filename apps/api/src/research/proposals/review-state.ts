import { prisma } from '../../infra/database/prisma.js';

export class ResearchCellChangeReviewOpenError extends Error {
  public constructor() {
    super('Research document has an open Agent change review');
    this.name = 'ResearchCellChangeReviewOpenError';
  }
}

export async function assertNoOpenCellChangeReview(documentId: string): Promise<void> {
  const review = await prisma.researchCellChangeProposal.findFirst({
    where: { documentId, reviewStatus: 'open' },
    select: { id: true },
  });
  if (review) {
    throw new ResearchCellChangeReviewOpenError();
  }
}
