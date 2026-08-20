import type { Prisma } from '@prisma/client';
import {
  DEFAULT_BACKTEST_COST,
  DEFAULT_BACKTEST_END,
  DEFAULT_BACKTEST_INITIAL_CASH,
  DEFAULT_BACKTEST_START,
  type BacktestConfig,
  type Locale,
  type ResearchStrategyDraftResultV1,
  type ResearchStrategyHandoffV1,
} from '@jixie/shared';
import { ulid } from 'ulid';
import { prisma } from '../lib/prisma.js';
import { uniqueStrategyName } from '../services/strategy-service.js';
import { getResearchExecution } from './research-execution-records.js';
import { generateResearchStrategyDraft } from './research-strategy-handoff.js';

export class ResearchStrategyDraftUnavailableError extends Error {}

export async function createResearchStrategyDraft(
  userId: string,
  executionId: string,
  locale: Locale,
): Promise<ResearchStrategyDraftResultV1 | null> {
  const existing = await prisma.strategy.findFirst({
    where: { userId, sourceResearchExecutionId: executionId },
    select: { id: true, name: true, config: true, researchHandoff: true },
  });
  if (existing) {
    return strategyDraftResult(existing, true);
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
      classifier: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
      codegen: process.env.DEEPSEEK_AGENT_MODEL ?? process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
    },
  };

  for (let attempt = 0; attempt < 50; attempt++) {
    const name = await uniqueStrategyName(prisma, userId, generated.strategyName);
    const config: BacktestConfig = {
      name,
      start: DEFAULT_BACKTEST_START,
      end: DEFAULT_BACKTEST_END,
      initialCash: DEFAULT_BACKTEST_INITIAL_CASH,
      cost: { ...DEFAULT_BACKTEST_COST },
      language: 'python',
      runtimeVersion: 'py-v1',
      code: generated.code,
    };
    try {
      const strategy = await prisma.strategy.create({
        data: {
          id: ulid(),
          userId,
          name,
          config: config as unknown as Prisma.InputJsonValue,
          messages: generated.messages as unknown as Prisma.InputJsonValue,
          sourceResearchExecutionId: execution.id,
          researchHandoff: handoff as unknown as Prisma.InputJsonValue,
        },
        select: { id: true, name: true, config: true, researchHandoff: true },
      });
      return strategyDraftResult(strategy, false);
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') {
        throw error;
      }
      const raced = await prisma.strategy.findFirst({
        where: { userId, sourceResearchExecutionId: execution.id },
        select: { id: true, name: true, config: true, researchHandoff: true },
      });
      if (raced) {
        return strategyDraftResult(raced, true);
      }
    }
  }
  throw new Error('Could not allocate a unique Strategy name for the research handoff.');
}

function strategyDraftResult(
  strategy: {
    id: string;
    name: string;
    config: Prisma.JsonValue;
    researchHandoff: Prisma.JsonValue | null;
  },
  reused: boolean,
): ResearchStrategyDraftResultV1 {
  const config = strategy.config as unknown as BacktestConfig;
  const handoff = strategy.researchHandoff as unknown as ResearchStrategyHandoffV1 | null;
  if (
    !handoff ||
    handoff.version !== 1 ||
    handoff.language !== 'python' ||
    config.language !== 'python' ||
    config.runtimeVersion !== 'py-v1'
  ) {
    throw new Error('The existing Strategy draft has invalid research handoff metadata.');
  }
  return {
    version: 1,
    strategyId: strategy.id,
    strategyName: strategy.name,
    language: 'python',
    handoff,
    reused,
  };
}
