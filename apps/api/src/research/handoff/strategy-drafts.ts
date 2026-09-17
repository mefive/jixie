import type {
  Locale,
  ResearchStrategyDraftResultV1,
  ResearchStrategyHandoffV1,
} from '@jixie/shared';
import {
  findResearchStrategyDraft,
  createStrategyDraftFromResearch,
} from '#strategy/definitions/from-research.js';
import { getDeepSeekAgentModel, getDeepSeekModel } from '#infra/llm/config.js';
import { getResearchExecution } from '../evidence/execution-records.js';
import { generateResearchStrategyDraft } from './strategy-handoff.js';

export class ResearchStrategyDraftUnavailableError extends Error {}

export async function createResearchStrategyDraft(
  userId: string,
  executionId: string,
  locale: Locale,
): Promise<ResearchStrategyDraftResultV1 | null> {
  const existing = await findResearchStrategyDraft(userId, executionId);
  if (existing) {
    return existing;
  }

  const execution = await getResearchExecution(userId, executionId);
  if (!execution) {
    return null;
  }
  if (execution.status !== 'success' || !execution.promotedAt) {
    throw new ResearchStrategyDraftUnavailableError(
      'Only a sealed, successful Research Execution can create a Strategy draft.',
    );
  }

  const generated = await generateResearchStrategyDraft(execution, locale);
  const generatedAt = new Date();
  const handoff: ResearchStrategyHandoffV1 = {
    version: 1,
    sourceExecutionId: execution.id,
    sourceDocumentId: execution.documentId,
    sourceContentRevision: execution.contentRevision,
    sourceHash: execution.sourceHash,
    sourceDisplayName: execution.displayName ?? execution.title,
    language: 'python',
    summary: generated.summary,
    unresolvedItems: generated.unresolvedItems,
    generatedAt: generatedAt.toISOString(),
    models: {
      classifier: getDeepSeekModel(),
      codegen: getDeepSeekAgentModel(),
    },
  };

  return createStrategyDraftFromResearch(userId, {
    sourceExecutionId: execution.id,
    strategyName: generated.strategyName,
    code: generated.code,
    messages: generated.messages,
    handoff,
  });
}
