import { prisma } from '#infra/database/prisma.js';
import { StrategyError } from '../errors.js';
import { extractFactorKeys } from '../factor-inputs/references.js';
import { codeConfigSchema, type StrategyVisibilityInput } from '../schema.js';

export async function setStrategyVisibility(
  userId: string,
  strategyId: string,
  input: StrategyVisibilityInput,
) {
  const strategy = await prisma.strategy.findFirst({
    where: { id: strategyId, userId: userId },
    select: { id: true, config: true },
  });

  if (!strategy) {
    throw new StrategyError('strategy_not_found');
  }

  const visibility = input.visibility;

  if (visibility === 'public') {
    const config = codeConfigSchema.parse(strategy.config);

    if (extractFactorKeys(config.code).length > 0) {
      throw new StrategyError('public_strategy_must_be_self_contained');
    }
  }

  const updated = await prisma.strategy.update({
    where: { id: strategy.id },
    data: { visibility },
    select: { id: true, visibility: true },
  });

  return updated;
}
