import { prisma } from '#infra/database/prisma.js';
import { KNOWN_INDICES } from './runtime/typescript/codegen-prompt.js';

export async function syncedIndexContext(): Promise<string> {
  const present = await prisma.indexWeight.findMany({
    select: { indexCode: true },
    distinct: ['indexCode'],
  });
  const codes = present.map((r) => r.indexCode).filter((cc) => KNOWN_INDICES[cc]);
  return codes.length
    ? codes.map((cc) => `${KNOWN_INDICES[cc]}=${cc}`).join('、')
    : '(no index constituents on record yet)';
}

export async function publishedFactorContext(userId: string): Promise<string> {
  const [factors, composites] = await Promise.all([
    prisma.factor.findMany({
      where: { userId, status: 'published' },
      select: { key: true, name: true, analysisKind: true, publishedAt: true },
    }),
    prisma.factorComposite.findMany({
      where: { userId, status: 'published', key: { not: null } },
      select: { key: true, name: true, publishedAt: true },
    }),
  ]);
  const rows = [
    ...factors,
    ...composites.map((row) => ({ ...row, key: row.key!, analysisKind: 'panel' })),
  ].sort((left, right) => (right.publishedAt?.getTime() ?? 0) - (left.publishedAt?.getTime() ?? 0));
  return rows.length
    ? rows
        .map((row) => {
          const kind =
            row.analysisKind === 'time_series'
              ? 'time_series ETF signal'
              : row.analysisKind === 'panel'
                ? 'cross_asset ETF panel factor'
                : 'cross_sectional stock factor';
          return `${row.name}=${row.key} (${kind})`;
        })
        .join('、')
    : '(no published factors yet)';
}
