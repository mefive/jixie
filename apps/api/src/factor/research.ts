import dayjs from 'dayjs';
import type {
  FactorHoldoutPolicyV1,
  FactorResearchCounts,
  FactorResearchIntentV1,
} from '@jixie/shared';
import { prisma } from '../lib/prisma.js';

export function parseResearchIntent(value: string | null): FactorResearchIntentV1 | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return JSON.parse(value) as FactorResearchIntentV1;
  } catch {
    return undefined;
  }
}

export function parseHoldoutPolicy(value: string | null): FactorHoldoutPolicyV1 | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return JSON.parse(value) as FactorHoldoutPolicyV1;
  } catch {
    return undefined;
  }
}

export async function getHoldoutPolicy(): Promise<FactorHoldoutPolicyV1 | null> {
  const latest = await prisma.daily.findFirst({
    orderBy: { tradeDate: 'desc' },
    select: { tradeDate: true },
  });
  if (!latest) {
    return null;
  }

  const cutoffDate = dayjs(latest.tradeDate, 'YYYYMMDD').subtract(18, 'month').format('YYYYMMDD');
  const explore = await prisma.daily.findFirst({
    where: { tradeDate: { lte: cutoffDate } },
    orderBy: { tradeDate: 'desc' },
    select: { tradeDate: true },
  });
  const holdout = explore
    ? await prisma.daily.findFirst({
        where: { tradeDate: { gt: explore.tradeDate } },
        orderBy: { tradeDate: 'asc' },
        select: { tradeDate: true },
      })
    : null;
  if (!explore || !holdout) {
    return null;
  }

  return {
    version: 1,
    months: 18,
    latestDate: latest.tradeDate,
    exploreEnd: explore.tradeDate,
    holdoutStart: holdout.tradeDate,
    holdoutEnd: latest.tradeDate,
    checkedAt: new Date().toISOString(),
  };
}

export function researchCounts(
  rows: Array<{ phase: string; status: string; testKey: string | null; revealedAt: Date | null }>,
): FactorResearchCounts {
  const completedExplore = rows.filter((row) => row.phase === 'explore' && row.status === 'done');
  const exploreTestCount = new Set(
    completedExplore.map((row) => row.testKey).filter((key): key is string => !!key),
  ).size;

  return {
    exploreRunCount: completedExplore.length,
    exploreTestCount,
    legacyRunCount: rows.filter((row) => row.phase === 'legacy').length,
    holdoutCount: rows.filter((row) => row.phase === 'holdout').length,
    revealedHoldoutCount: rows.filter((row) => row.phase === 'holdout' && row.revealedAt !== null)
      .length,
    expectedFalsePositivesAtFivePercent: exploreTestCount * 0.05,
  };
}

export function enoughHoldoutPeriods(freq: 'month' | 'week', start: string, end: string): boolean {
  const days = dayjs(end, 'YYYYMMDD').diff(dayjs(start, 'YYYYMMDD'), 'day');
  return freq === 'week' ? days >= 77 : days >= 152;
}
