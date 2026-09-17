import { prisma } from '#infra/database/prisma.js';
import { FactorError } from '../errors.js';
import type { FactorVisibilityInput } from '../schema.js';

export async function setFactorVisibility(
  userId: string,
  factorId: string,
  input: FactorVisibilityInput,
) {
  const visibility = input.visibility;
  const factor = await prisma.factor.findFirst({
    where: { id: factorId, userId },
    select: { id: true, status: true },
  });

  if (!factor) {
    throw new FactorError('factor_not_found');
  }

  if (visibility === 'public' && factor.status !== 'published') {
    throw new FactorError('asset_must_be_published_before_sharing');
  }

  return await prisma.factor.update({
    where: { id: factor.id },
    data: { visibility },
    select: { id: true, visibility: true },
  });
}

export async function setCompositeVisibility(
  userId: string,
  compositeId: string,
  input: FactorVisibilityInput,
) {
  const visibility = input.visibility;
  const composite = await prisma.factorComposite.findFirst({
    where: { id: compositeId, userId },
    select: { id: true, status: true },
  });

  if (!composite) {
    throw new FactorError('factor_not_found');
  }

  if (visibility === 'public' && composite.status !== 'published') {
    throw new FactorError('asset_must_be_published_before_sharing');
  }

  return await prisma.factorComposite.update({
    where: { id: composite.id },
    data: { visibility },
    select: { id: true, visibility: true },
  });
}
