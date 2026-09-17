import { prisma } from '#infra/database/prisma.js';
import type { BacktestSummary, StrategyCard } from '@jixie/shared';
import { StrategyError } from '../errors.js';

export async function listStrategies(userId: string) {
  const rows = await prisma.strategy.findMany({
    where: { userId: userId },
    select: {
      id: true,
      name: true,
      visibility: true,
      createdAt: true,
      updatedAt: true,
      lastResult: true,
    },
    orderBy: { updatedAt: 'desc' },
  });
  const cards: StrategyCard[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    visibility: r.visibility === 'public' ? 'public' : 'private',
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    snapshot: strategyCardSnapshot(r.lastResult),
  }));

  return cards;
}

function strategyCardSnapshot(lastResult: unknown): StrategyCard['snapshot'] {
  const r = lastResult as BacktestSummary | null;

  if (!r || !Array.isArray(r.nav) || r.nav.length === 0) {
    return undefined;
  }

  const vals = r.nav.map((n) => n.value);
  const N = 48;
  const step = Math.max(1, Math.floor(vals.length / N));
  const spark = vals.filter((_, i) => i % step === 0);

  return { totalReturn: r.totalReturn, sharpe: r.sharpe, trades: r.trades, spark };
}

export async function readStrategy(userId: string, strategyId: string) {
  const row = await prisma.strategy.findFirst({
    where: { id: strategyId, userId: userId },
    include: {
      sourceResearchExecution: {
        select: {
          id: true,
          documentId: true,
          title: true,
          displayName: true,
          sequence: true,
          promotedAt: true,
        },
      },
    },
  });

  if (!row) {
    throw new StrategyError('strategy_not_found');
  }

  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    config: row.config,
    lastResult: row.lastResult,
    messages: row.messages,
    researchHandoff: row.researchHandoff,
    sourceResearchExecution: row.sourceResearchExecution
      ? {
          ...row.sourceResearchExecution,
          promotedAt: row.sourceResearchExecution.promotedAt?.toISOString() ?? null,
        }
      : null,
    visibility: row.visibility === 'public' ? 'public' : 'private',
  };
}
