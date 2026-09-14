import { withEmbeddedAnalysis } from '#agent/profiles/embedded.js';
import { captureEmbeddedContext } from '#research/embedded/context.js';
import {
  embeddedDataReferencesSchema,
  embeddedUserParts,
} from '#research/embedded/data-references.js';
import { z } from 'zod';
import { prisma } from '#infra/database/prisma.js';
import { ulid } from 'ulid';
import { strategyProfile } from '#agent/profiles/strategy.js';
import { enqueueAgentTurn, entityKey } from '#agent/turns/run.js';
import * as turnBus from '#agent/turns/bus.js';
import { syncedIndexContext, publishedFactorContext } from './agent-context.js';
import { t } from '#i18n/index.js';
import type { Locale } from '@jixie/shared';
import { failStrategyOperation } from './operation-errors.js';

export const strategyAgentInputSchema = z.object({
  id: z.string().min(1),
  message: z.string().trim().min(1).max(2000),
  reportId: z.string().min(1).max(128).optional(),
  dataReferences: embeddedDataReferencesSchema,
  code: z.string().min(1).max(50_000),
  language: z.enum(['typescript', 'python']).optional(),
});

export async function startStrategyAgentTurn(
  userId: string,
  rawInput: z.input<typeof strategyAgentInputSchema>,
  locale: Locale,
) {
  const input = strategyAgentInputSchema.parse(rawInput);
  const { id, message, code, language = 'typescript' } = input;
  const strategy = await prisma.strategy.findFirst({ where: { id, userId }, select: { id: true } });

  if (!strategy) {
    return failStrategyOperation('missing', t(locale, 'strategyNotFound'));
  }

  const entity = { kind: 'strategy' as const, id };

  if (turnBus.findRunning(entityKey(entity), userId)) {
    return failStrategyOperation('invalid', t(locale, 'strategyTurnInProgress'));
  }

  const [idx, factors] = await Promise.all([syncedIndexContext(), publishedFactorContext(userId)]);
  const turnId = ulid();

  const embeddedSource = await captureEmbeddedContext(
    prisma,
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
    locale,
  });

  return { turnId };
}
