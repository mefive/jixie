import type { Locale, ResearchFactorDraftResultV1, ResearchFactorHandoffV1 } from '@jixie/shared';
import {
  findResearchFactorDraft,
  createFactorDraftFromResearch,
} from '#factor/definitions/from-research.js';
import { getDeepSeekAgentModel, getDeepSeekModel } from '#infra/llm/config.js';
import { getResearchExecution } from '../evidence/execution-records.js';
import { generateResearchFactorDraft } from './factor-handoff.js';

export class ResearchFactorDraftUnavailableError extends Error {}

export async function createResearchFactorDraft(
  userId: string,
  executionId: string,
  locale: Locale,
): Promise<ResearchFactorDraftResultV1 | null> {
  const existing = await findResearchFactorDraft(userId, executionId);
  if (existing) {
    return existing;
  }

  const execution = await getResearchExecution(userId, executionId);
  if (!execution) {
    return null;
  }
  if (execution.status !== 'success' || !execution.promotedAt) {
    throw new ResearchFactorDraftUnavailableError(
      'Only a sealed, successful Research Execution can create a Factor draft.',
    );
  }

  const generated = await generateResearchFactorDraft(execution, locale);
  const generatedAt = new Date();
  const handoff: ResearchFactorHandoffV1 = {
    version: 1,
    sourceExecutionId: execution.id,
    sourceDocumentId: execution.documentId,
    sourceContentRevision: execution.contentRevision,
    sourceHash: execution.sourceHash,
    sourceDisplayName: execution.displayName ?? execution.title,
    analysisKind: generated.analysisKind,
    language: generated.language,
    summary: generated.summary,
    unresolvedItems: generated.unresolvedItems,
    suggestedReport: generated.suggestedReport,
    generatedAt: generatedAt.toISOString(),
    models: {
      classifier: getDeepSeekModel(),
      codegen: getDeepSeekAgentModel(),
    },
  };

  return createFactorDraftFromResearch(userId, {
    sourceExecutionId: execution.id,
    factorKeyBase: generated.factorKeyBase,
    factorName: generated.factorName,
    analysisKind: generated.analysisKind,
    language: generated.language,
    code: generated.code,
    messages: generated.messages,
    handoff,
    locale,
  });
}
