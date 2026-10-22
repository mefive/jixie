import { withEmbeddedAnalysis } from '#agent/profiles/embedded.js';
import { strategyProfile } from '#agent/profiles/strategy.js';
import * as turnBus from '#agent/turns/bus.js';
import { enqueueAgentTurn, entityKey } from '#agent/turns/run.js';
import { getDatabase } from '#infra/database/prisma.js';
import { captureEmbeddedContext } from '#research/embedded/context.js';
import { embeddedUserParts } from '#research/embedded/data-references.js';
import type { Locale } from '@jixie/shared';
import { ulid } from 'ulid';
import { StrategyError } from '../errors.js';
import { strategyCodeIdentity } from './code-proposals.js';
import type { StrategyAgentInput } from '../schema.js';
import { publishedFactorContext, syncedIndexContext } from './context.js';

/**
 * 校验策略归属并创建后台 Agent 轮次，持久化输入和初始状态。
 *
 * Authorize a strategy and start a persisted background agent turn.
 */
export async function startStrategyAgentTurn(
  userId: string,
  input: StrategyAgentInput,
  locale: Locale,
) {
  const { id, message, code, language = 'typescript' } = input;
  const strategy = await getDatabase().strategy.findFirst({
    where: { id, userId },
    select: { id: true, config: true },
  });

  if (!strategy) {
    throw new StrategyError('strategy_not_found');
  }

  const entity = { kind: 'strategy' as const, id };

  if (turnBus.findRunning(entityKey(entity), userId)) {
    throw new StrategyError('strategy_turn_in_progress');
  }

  const [idx, factors] = await Promise.all([syncedIndexContext(), publishedFactorContext(userId)]);
  const turnId = ulid();

  const embeddedSource = await captureEmbeddedContext(
    getDatabase(),
    userId,
    { type: 'strategy', id },
    input.reportId,
  );
  enqueueAgentTurn({
    turnId,
    userId,
    profile: withEmbeddedAnalysis(strategyProfile(idx, factors, language), {
      userId,
      source: embeddedSource,
      dataReferences: input.dataReferences,
    }),
    entity,
    message,
    userParts: embeddedUserParts(message, input.dataReferences),
    currentCode: code,
    codeProposal: {
      surface: 'strategy',
      entityId: id,
      language,
      beforeCode: code,
      baseIdentity: strategyCodeIdentity(strategy.config),
    },
    locale,
  });

  return { turnId };
}
