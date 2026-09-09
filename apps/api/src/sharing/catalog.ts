import type { BacktestConfig, SharingCatalog } from '@jixie/shared';
import { prisma } from '../infra/database/prisma.js';
import { extractFactorKeys } from '../strategy/execution/prepare-factors.js';

export async function listSharingCatalog(
  userId: string,
  user: { name: string | null; email: string },
): Promise<SharingCatalog> {
  const [
    publicStrategies,
    publicFactors,
    publicComposites,
    ownStrategies,
    ownFactors,
    ownComposites,
  ] = await Promise.all([
    prisma.strategy.findMany({
      where: { visibility: 'public' },
      select: {
        id: true,
        userId: true,
        name: true,
        visibility: true,
        updatedAt: true,
        user: { select: { name: true, email: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    }),
    prisma.factor.findMany({
      where: { visibility: 'public', status: 'published' },
      select: {
        id: true,
        userId: true,
        key: true,
        name: true,
        analysisKind: true,
        language: true,
        visibility: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    }),
    prisma.factorComposite.findMany({
      where: { visibility: 'public', status: 'published', key: { not: null } },
      select: {
        id: true,
        userId: true,
        key: true,
        name: true,
        visibility: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    }),
    prisma.strategy.findMany({
      where: { userId },
      select: { id: true, name: true, config: true, visibility: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.factor.findMany({
      where: { userId, status: 'published' },
      select: {
        id: true,
        key: true,
        name: true,
        analysisKind: true,
        language: true,
        visibility: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.factorComposite.findMany({
      where: { userId, status: 'published', key: { not: null } },
      select: { id: true, key: true, name: true, visibility: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    }),
  ]);

  const factorOwnerIds = [
    ...new Set([...publicFactors, ...publicComposites].map((asset) => asset.userId)),
  ];
  const owners = await prisma.user.findMany({
    where: { id: { in: factorOwnerIds } },
    select: { id: true, name: true, email: true },
  });
  const ownerById = new Map(owners.map((owner) => [owner.id, authorLabel(owner)]));
  const currentAuthor = authorLabel(user);

  const response: SharingCatalog = {
    strategies: publicStrategies.map((asset) => ({
      id: asset.id,
      kind: 'strategy',
      name: asset.name,
      author: authorLabel(asset.user),
      owned: asset.userId === userId,
      visibility: 'public',
      updatedAt: asset.updatedAt.toISOString(),
    })),
    factors: [
      ...publicFactors.map((asset) => ({
        id: asset.id,
        kind: 'factor' as const,
        key: asset.key,
        name: asset.name,
        analysisKind: asset.analysisKind,
        language: asset.language === 'python' ? ('python' as const) : ('typescript' as const),
        author: ownerById.get(asset.userId) ?? '—',
        owned: asset.userId === userId,
        visibility: 'public' as const,
        updatedAt: asset.updatedAt.toISOString(),
      })),
      ...publicComposites.map((asset) => ({
        id: asset.id,
        kind: 'composite' as const,
        key: asset.key!,
        name: asset.name,
        analysisKind: 'panel',
        language: 'typescript' as const,
        author: ownerById.get(asset.userId) ?? '—',
        owned: asset.userId === userId,
        visibility: 'public' as const,
        updatedAt: asset.updatedAt.toISOString(),
      })),
    ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    mine: {
      strategies: ownStrategies
        .filter((asset) => {
          const config = asset.config as unknown as BacktestConfig;
          return asset.visibility === 'public' || extractFactorKeys(config.code).length === 0;
        })
        .map((asset) => ({
          id: asset.id,
          kind: 'strategy',
          name: asset.name,
          author: currentAuthor,
          owned: true,
          visibility: asset.visibility === 'public' ? 'public' : 'private',
          updatedAt: asset.updatedAt.toISOString(),
        })),
      factors: [
        ...ownFactors.map((asset) => ({
          id: asset.id,
          kind: 'factor' as const,
          key: asset.key,
          name: asset.name,
          analysisKind: asset.analysisKind,
          language: asset.language === 'python' ? ('python' as const) : ('typescript' as const),
          author: currentAuthor,
          owned: true,
          visibility: asset.visibility === 'public' ? ('public' as const) : ('private' as const),
          updatedAt: asset.updatedAt.toISOString(),
        })),
        ...ownComposites.map((asset) => ({
          id: asset.id,
          kind: 'composite' as const,
          key: asset.key!,
          name: asset.name,
          analysisKind: 'panel',
          language: 'typescript' as const,
          author: currentAuthor,
          owned: true,
          visibility: asset.visibility === 'public' ? ('public' as const) : ('private' as const),
          updatedAt: asset.updatedAt.toISOString(),
        })),
      ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    },
  };
  return response;
}

export async function getPublicStrategy(strategyId: string) {
  const strategy = await prisma.strategy.findFirst({
    where: { id: strategyId, visibility: 'public' },
    select: {
      id: true,
      name: true,
      config: true,
      updatedAt: true,
      user: { select: { name: true, email: true } },
    },
  });
  return strategy ? { ...strategy, author: authorLabel(strategy.user) } : null;
}

function authorLabel(user: { name: string | null; email: string }): string {
  if (user.name?.trim()) {
    return user.name.trim();
  }
  const [local = '', domain = ''] = user.email.split('@');
  return `${local.slice(0, 1) || '*'}***${domain ? `@${domain}` : ''}`;
}
