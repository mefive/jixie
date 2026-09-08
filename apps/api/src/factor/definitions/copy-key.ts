import type { Prisma } from '@prisma/client';
import { BUILTIN_KEYS } from './builtin-factors.js';
import { FactorPublicationError } from '../publication/factor.js';

export async function nextCopyKey(
  database: Pick<Prisma.TransactionClient, 'factor' | 'factorComposite'>,
  userId: string,
  sourceKey: string,
): Promise<{ key: string; version: number }> {
  const matched = sourceKey.match(/^(.*)_v(\d+)$/);
  const base = matched?.[1] || sourceKey;
  const startingVersion = matched ? Number(matched[2]) + 1 : 2;
  for (let version = startingVersion; version <= startingVersion + 100; version++) {
    const suffix = `_v${version}`;
    const key = `${base.slice(0, 32 - suffix.length).replace(/_+$/g, '')}${suffix}`;
    const [factorTaken, compositeTaken] = await Promise.all([
      database.factor.findFirst({ where: { userId, key }, select: { id: true } }),
      database.factorComposite.findFirst({ where: { userId, key }, select: { id: true } }),
    ]);
    if (!factorTaken && !compositeTaken && !BUILTIN_KEYS.has(key)) {
      return { key, version };
    }
  }
  throw new FactorPublicationError('not_draft');
}
