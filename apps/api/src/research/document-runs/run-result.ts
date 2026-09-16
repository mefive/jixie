import type { ResearchExecutionSummaryV1, ResearchDocumentRunResultV1 } from '@jixie/shared';
import { getResearchDocument } from '../documents/read.js';

export async function researchDocumentRunResult(
  userId: string,
  documentId: string,
  executedCellIds: string[],
  clean: boolean,
  execution?: ResearchExecutionSummaryV1,
): Promise<ResearchDocumentRunResultV1> {
  return {
    version: 1,
    document: (await getResearchDocument(userId, documentId))!,
    executedCellIds,
    clean,
    ...(execution ? { execution } : {}),
  };
}
