import { factorAgentInputSchema } from './schema.js';
import { withEmbeddedAnalysis } from '#agent/profiles/embedded.js';
import { captureEmbeddedContext } from '#research/embedded/context.js';
import { embeddedUserParts } from '#research/embedded/data-references.js';
import { ulid } from 'ulid';
import type { z } from 'zod';
import { prisma } from '#infra/database/prisma.js';
import { factorProfile } from '#agent/profiles/factor.js';
import { enqueueAgentTurn, entityKey } from '#agent/turns/run.js';
import * as turnBus from '#agent/turns/bus.js';
import { refreshFactorMetadata } from './definitions/metadata.js';
import { t } from '#i18n/index.js';
import type { Locale } from '@jixie/shared';
import { failFactorOperation } from './operation-errors.js';

export async function startFactorAgentTurn(
  userId: string,
  rawInput: z.input<typeof factorAgentInputSchema>,
  locale: Locale,
) {
  const input = factorAgentInputSchema.parse(rawInput);
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
    afterTurn: async (result, messages) => {
      await refreshFactorMetadata({ factorId: id, userId, code: result.code, messages });
    },
  });

  return { turnId };
}
