import { z } from 'zod';
import { prisma } from '#infra/database/prisma.js';
import { t } from '#i18n/index.js';
import type { Locale } from '@jixie/shared';
import { failFactorOperation } from '../operation-errors.js';

export const factorVisibilitySchema = z.object({ visibility: z.enum(['private', 'public']) });

export async function setFactorVisibility(
  userId: string,
  factorId: string,
  input: z.infer<typeof factorVisibilitySchema>,
  locale: Locale,
) {
  const visibility = input.visibility;
  const factor = await prisma.factor.findFirst({
    where: { id: factorId, userId },
    select: { id: true, status: true },
  });

  if (!factor) {
    return failFactorOperation('missing', t(locale, 'factorNotFound'));
  }

  if (visibility === 'public' && factor.status !== 'published') {
    return failFactorOperation('invalid', t(locale, 'assetMustBePublishedBeforeSharing'));
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
  input: z.infer<typeof factorVisibilitySchema>,
  locale: Locale,
) {
  const visibility = input.visibility;
  const composite = await prisma.factorComposite.findFirst({
    where: { id: compositeId, userId },
    select: { id: true, status: true },
  });

  if (!composite) {
    return failFactorOperation('missing', t(locale, 'factorNotFound'));
  }

  if (visibility === 'public' && composite.status !== 'published') {
    return failFactorOperation('invalid', t(locale, 'assetMustBePublishedBeforeSharing'));
  }

  return await prisma.factorComposite.update({
    where: { id: composite.id },
    data: { visibility },
    select: { id: true, visibility: true },
  });
}
