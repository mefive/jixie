import { strategyVisibilitySchema, codeConfigSchema } from '../schema.js';
import type { z } from 'zod';
import { prisma } from '#infra/database/prisma.js';
import { extractFactorKeys } from '../execution/prepare-factors.js';
import { t } from '#i18n/index.js';
import type { Locale } from '@jixie/shared';
import { failStrategyOperation } from '../operation-errors.js';

export async function setStrategyVisibility(
  userId: string,
  strategyId: string,
  input: z.infer<typeof strategyVisibilitySchema>,
  locale: Locale,
) {
  const strategy = await prisma.strategy.findFirst({
    where: { id: strategyId, userId: userId },
    select: { id: true, config: true },
  });

  if (!strategy) {
    return failStrategyOperation('missing', t(locale, 'strategyNotFound'));
  }

  const visibility = input.visibility;

  if (visibility === 'public') {
    const config = codeConfigSchema.parse(strategy.config);

    if (extractFactorKeys(config.code).length > 0) {
      return failStrategyOperation('invalid', t(locale, 'publicStrategyMustBeSelfContained'));
    }
  }

  const updated = await prisma.strategy.update({
    where: { id: strategy.id },
    data: { visibility },
    select: { id: true, visibility: true },
  });

  return updated;
}
