import type { Prisma } from '@prisma/client';
import {
  DEFAULT_BACKTEST_COST,
  DEFAULT_BACKTEST_END,
  DEFAULT_BACKTEST_INITIAL_CASH,
  DEFAULT_BACKTEST_START,
  type BacktestConfig,
  type ChatMessage,
  type ResearchStrategyDraftResultV1,
  type ResearchStrategyHandoffV1,
} from '@jixie/shared';
import { ulid } from 'ulid';
import { getDatabase } from '#infra/database/prisma.js';
import { uniqueStrategyName } from './naming.js';

/**
 * 承载从封存研究生成策略草稿所需的证据和代码输入。
 *
 * Supply frozen research evidence and source for creating a strategy draft.
 */
export interface StrategyDraftFromResearchInput {
  sourceExecutionId: string;
  strategyName: string;
  code: string;
  messages: ChatMessage[];
  handoff: ResearchStrategyHandoffV1;
}

export async function findResearchStrategyDraft(
  userId: string,
  executionId: string,
): Promise<ResearchStrategyDraftResultV1 | null> {
  const existing = await getDatabase().strategy.findFirst({
    where: { userId, sourceResearchExecutionId: executionId },
    select: { id: true, name: true, config: true, researchHandoff: true },
  });

  return existing ? strategyDraftResult(existing, true) : null;
}

/**
 * 从已授权封存研究创建带来源血缘的策略草稿。
 *
 * Create a strategy draft with provenance from authorized frozen research.
 */
export async function createStrategyDraftFromResearch(
  userId: string,
  input: StrategyDraftFromResearchInput,
): Promise<ResearchStrategyDraftResultV1> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const name = await uniqueStrategyName(getDatabase(), userId, input.strategyName);
    const config: BacktestConfig = {
      name,
      start: DEFAULT_BACKTEST_START,
      end: DEFAULT_BACKTEST_END,
      initialCash: DEFAULT_BACKTEST_INITIAL_CASH,
      cost: { ...DEFAULT_BACKTEST_COST },
      language: 'python',
      runtimeVersion: 'py-v1',
      code: input.code,
    };
    try {
      const strategy = await getDatabase().strategy.create({
        data: {
          id: ulid(),
          userId,
          name,
          config: config as unknown as Prisma.InputJsonValue,
          messages: input.messages as unknown as Prisma.InputJsonValue,
          sourceResearchExecutionId: input.sourceExecutionId,
          researchHandoff: input.handoff as unknown as Prisma.InputJsonValue,
        },
        select: { id: true, name: true, config: true, researchHandoff: true },
      });
      return strategyDraftResult(strategy, false);
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') {
        throw error;
      }
      const raced = await findResearchStrategyDraft(userId, input.sourceExecutionId);
      if (raced) {
        return raced;
      }
    }
  }
  throw new Error('Could not allocate a unique Strategy name for the research handoff.');
}

/**
 * 将新建策略草稿与来源身份整理为交接响应。
 *
 * Build the handoff response for a created strategy draft and its provenance.
 */
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
