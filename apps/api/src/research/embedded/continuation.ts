import { t } from '#i18n/index.js';
import { getDatabase } from '#infra/database/prisma.js';
import type { Locale } from '@jixie/shared';
import { ulid } from 'ulid';
import { cellCreate } from '../documents/cell-seed.js';
import { ResearchError } from '../errors.js';

/**
 * 复制当前分析代码及参数到普通文档；重复操作返回同一文档，运行时重新取数。
 *
 * Copy current code and parameters into an ordinary document; repeated clicks reuse the document and runs fetch current data.
 */
export async function continueEmbeddedResearch(
  userId: string,
  analysisId: string,
  runId: string,
  locale: Locale,
) {
  const documentId = await getDatabase().$transaction(async (transaction) => {
    const run = await transaction.researchExecution.findFirst({
      where: { id: runId, embeddedVersion: { analysisId, analysis: { userId } } },
      include: { embeddedVersion: { include: { analysis: true } } },
    });
    if (!run?.embeddedVersion) {
      throw new ResearchError('embedded_not_found');
    }
    const embeddedRunKey = `${userId}:${runId}`;
    const existing = await transaction.researchDocument.findUnique({ where: { embeddedRunKey } });
    if (existing) {
      await transaction.agentConversation.update({
        where: { id: existing.conversationId },
        data: { archivedAt: null },
      });
      return existing.id;
    }
    const id = ulid();
    await transaction.agentConversation.create({
      data: { id, userId, surface: 'research', title: run.embeddedVersion.analysis.title },
    });
    await transaction.researchDocument.create({
      data: {
        id,
        userId,
        conversationId: id,
        embeddedRunKey,
        cells: {
          create: [
            cellCreate(
              {
                kind: 'markdown',
                source: t(locale, 'researchEmbeddedContinuationNote', {
                  title: run.embeddedVersion.analysis.title,
                  scope: run.embeddedVersion.inputScope,
                  runId,
                }),
              },
              0,
            ),
            cellCreate(
              {
                kind: 'python',
                source: `parameters = {${Object.entries(
                  (run.embeddedVersion.parameters as Record<string, unknown>) ?? {},
                )
                  .map(
                    ([key, value]) =>
                      `${JSON.stringify(key)}: ${value === null ? 'None' : value === true ? 'True' : value === false ? 'False' : JSON.stringify(value)}`,
                  )
                  .join(', ')}}`,
              },
              1,
            ),
            cellCreate({ kind: 'python', source: run.embeddedVersion.source }, 2),
          ],
        },
      },
    });
    return id;
  });
  return { documentId };
}
