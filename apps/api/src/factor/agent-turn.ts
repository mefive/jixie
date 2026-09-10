import { ulid } from 'ulid';
import { z } from 'zod';
import { prisma } from '#infra/database/prisma.js';
import { factorProfile } from '#agent/profiles/factor.js';
import { factorQaProfile } from '#agent/profiles/qa.js';
import { enqueueAgentTurn, entityKey } from '#agent/turns/run.js';
import * as turnBus from '#agent/turns/bus.js';
import { chatMessagesSchema } from '#agent/conversations/schema.js';
import { refreshFactorMetadata } from './definitions/metadata.js';
import { t } from '#i18n/index.js';
import type { Locale } from '@jixie/shared';
import { failFactorOperation } from './operation-errors.js';

export const factorAgentInputSchema = z.object({
  id: z.string().min(1),
  message: z.string().trim().min(1).max(2000),
  code: z.string().min(1).max(20_000),
});

export async function startFactorAgentTurn(
  userId: string,
  input: z.infer<typeof factorAgentInputSchema>,
  locale: Locale,
) {
  const { id, message, code } = input;
  const factor = await prisma.factor.findFirst({
    where: { id, userId },
    select: { id: true, analysisKind: true, language: true, status: true },
  });

  if (!factor) {
    return failFactorOperation('missing', t(locale, 'factorNotFound'));
  }

  if (factor.status !== 'draft') {
    return failFactorOperation('invalid', t(locale, 'publishedFactorReadonly'));
  }

  const entity = { kind: 'factor' as const, id };

  if (turnBus.findRunning(entityKey(entity), userId)) {
    return failFactorOperation('invalid', t(locale, 'factorTurnInProgress'));
  }

  const turnId = ulid();

  enqueueAgentTurn({
    turnId,
    userId,
    profile: factorProfile({
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
    entity,
    message,
    currentCode: code,
    locale,
    afterTurn: async (result, messages) => {
      await refreshFactorMetadata({ factorId: id, userId, code: result.code, messages });
    },
  });

  return { turnId };
}

export const presetFactorQuestionSchema = z.object({
  history: chatMessagesSchema.default([]),
  message: z.string().trim().min(1).max(2000),
  factorName: z.string().max(80).optional(),
});

export function startPresetFactorQuestion(
  userId: string,
  input: z.infer<typeof presetFactorQuestionSchema>,
  locale: Locale,
) {
  const { history, message, factorName } = input;
  const turnId = ulid();

  enqueueAgentTurn({
    turnId,
    userId: userId,
    profile: factorQaProfile(factorName),
    entity: null,
    history,
    message,
    currentCode: '',
    locale: locale,
  });

  return { turnId };
}
