import { withEmbeddedAnalysis } from '#agent/profiles/embedded.js';
import { factorProfile } from '#agent/profiles/factor.js';
import * as turnBus from '#agent/turns/bus.js';
import { enqueueAgentTurn, entityKey } from '#agent/turns/run.js';
import { prisma } from '#infra/database/prisma.js';
import { captureEmbeddedContext } from '#research/embedded/context.js';
import { embeddedUserParts } from '#research/embedded/data-references.js';
import type { Locale } from '@jixie/shared';
import { ulid } from 'ulid';
import { factorCodeIdentity } from './code-proposals.js';
import { FactorError } from '../errors.js';
import type { FactorAgentInput } from '../schema.js';

/**
 * 校验因子草稿归属与当前上下文，持久化并启动后台 Agent 轮次。
 *
 * Authorize a factor draft, capture its context and start a persisted agent turn.
 */
export async function startFactorAgentTurn(
  userId: string,
  input: FactorAgentInput,
  locale: Locale,
) {
  const { id, message, code } = input;
  const factor = await prisma.factor.findFirst({
    where: { id, userId },
    select: {
      id: true,
      code: true,
      runtimeVersion: true,
      analysisKind: true,
      language: true,
      status: true,
    },
  });

  if (!factor) {
    throw new FactorError('factor_not_found');
  }

  if (factor.status !== 'draft') {
    throw new FactorError('published_factor_readonly');
  }

  const entity = { kind: 'factor' as const, id };

  if (turnBus.findRunning(entityKey(entity), userId)) {
    throw new FactorError('factor_turn_in_progress');
  }

  const turnId = ulid();

  const embeddedSource = await captureEmbeddedContext(
    prisma,
    userId,
    { type: 'factor', id },
    input.reportId,
  );
  enqueueAgentTurn({
    turnId,
    userId,
    profile: withEmbeddedAnalysis(
      factorProfile({
        userId,
        factorId: id,
        currentCode: code,
        locale,
        language: factor.language === 'python' ? 'python' : 'typescript',
        analysisKind:
          factor.analysisKind === 'time_series' || factor.analysisKind === 'panel'
            ? factor.analysisKind
            : 'cross_sectional',
      }),
      { userId, source: embeddedSource, dataReferences: input.dataReferences },
    ),
    entity,
    message,
    userParts: embeddedUserParts(message, input.dataReferences),
    currentCode: code,
    locale,
    codeProposal: {
      surface: 'factor',
      entityId: id,
      language: factor.language === 'python' ? 'python' : 'typescript',
      baseIdentity: factorCodeIdentity(factor),
      beforeCode: code,
    },
  });

  return { turnId };
}
