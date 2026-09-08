import { z } from 'zod';
import type { ChatMessage } from '@jixie/shared';
import { prisma } from '../../infra/database/prisma.js';
import { refreshFactorMetadata } from './metadata.js';
import { t } from '../../i18n/index.js';
import type { Locale } from '@jixie/shared';
import { failFactorOperation } from '../operation-errors.js';

export const factorMetadataInputSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1).max(20_000),
});

export async function refreshOwnedFactorMetadata(
  userId: string,
  input: z.infer<typeof factorMetadataInputSchema>,
  locale: Locale,
) {
  const { id, code } = input;
  const factor = await prisma.factor.findFirst({
    where: { id, userId: userId },
    select: { messages: true, status: true },
  });

  if (!factor) {
    return failFactorOperation('missing', t(locale, 'factorNotFound'));
  }

  if (factor.status !== 'draft') {
    return failFactorOperation('invalid', t(locale, 'publishedFactorReadonly'));
  }

  try {
    await refreshFactorMetadata({
      factorId: id,
      userId: userId,
      code,
      messages: Array.isArray(factor.messages) ? (factor.messages as unknown as ChatMessage[]) : [],
    });
  } catch (error) {
    return failFactorOperation(
      'unavailable',
      error instanceof Error ? error.message : t(locale, 'nameFailed'),
    );
  }

  return { ok: true };
}
