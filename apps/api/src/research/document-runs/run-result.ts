import type { ResearchDocumentRunResultV1 } from '@jixie/shared';
import { getResearchDocument } from '../documents/read.js';

export async function buildResearchDocumentRunResult(
  userId: string,
  documentId: string,
  executedCellIds: string[],
  clean: boolean,
): Promise<ResearchDocumentRunResultV1> {
  return {
    version: 1,
    document: (await getResearchDocument(userId, documentId))!,
    executedCellIds,
    clean,
  };
}
