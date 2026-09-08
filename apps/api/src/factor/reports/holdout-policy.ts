import type { FactorReport as FactorReportRow } from '@prisma/client';
import type { FactorHoldoutEligibility } from '@jixie/shared';
import { prisma } from '../../infra/database/prisma.js';
import { enoughHoldoutPeriods, getHoldoutPolicy, parseResearchIntent } from './research-policy.js';
import { resolveEtfCommonLatest } from '../observations/asset-factor-data-cutoff.js';
import { reportResearchSpec } from './views.js';

export async function holdoutEligibility(row: FactorReportRow): Promise<FactorHoldoutEligibility> {
  if (row.phase !== 'explore') {
    return { eligible: false, reason: 'not_explore' };
  }
  if (row.status !== 'done') {
    return { eligible: false, reason: 'not_done' };
  }
  const intent = parseResearchIntent(row.researchIntentJson);
  if (
    !intent ||
    intent.mode !== 'hypothesis' ||
    intent.expectedDirection === 'unknown' ||
    !intent.primaryCriterion
  ) {
    return { eligible: false, reason: 'missing_hypothesis' };
  }
  const researchSpec = reportResearchSpec(row);
  const basePolicy = await getHoldoutPolicy();
  const policy =
    basePolicy &&
    (researchSpec.analysisKind === 'time_series' || researchSpec.analysisKind === 'panel')
      ? await capHoldoutPolicyAtEtfData(
          basePolicy,
          researchSpec.analysisKind === 'panel'
            ? researchSpec.assets.map((asset) => asset.assetId)
            : researchSpec.assets,
        )
      : basePolicy;
  if (!policy || row.end > policy.exploreEnd) {
    return { eligible: false, reason: 'outside_explore_window', window: policy ?? undefined };
  }
  const frequency =
    researchSpec.analysisKind === 'cross_sectional'
      ? researchSpec.protocol.freq
      : researchSpec.analysisKind === 'time_series'
        ? 'day'
        : researchSpec.analysisKind === 'panel'
          ? 'month'
          : null;
  if (!frequency || !enoughHoldoutPeriods(frequency, policy.holdoutStart, policy.holdoutEnd)) {
    return { eligible: false, reason: 'insufficient_periods', window: policy };
  }
  const existing = await prisma.factorReport.findFirst({
    where: {
      userId: row.userId,
      parentReportId: row.id,
      phase: 'holdout',
      status: { in: ['running', 'done'] },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (existing) {
    return {
      eligible: false,
      reason: 'already_exists',
      existingReportId: existing.id,
      window: policy,
    };
  }
  const observed = row.factorCodeHash
    ? await prisma.factorReport.findFirst({
        where: {
          userId: row.userId,
          id: { not: row.id },
          factorCodeHash: row.factorCodeHash,
          status: 'done',
          end: { gt: policy.exploreEnd },
        },
        select: { id: true },
      })
    : null;
  if (observed) {
    return { eligible: false, reason: 'already_observed', window: policy };
  }

  return { eligible: true, window: policy };
}

async function capHoldoutPolicyAtEtfData(
  policy: NonNullable<Awaited<ReturnType<typeof getHoldoutPolicy>>>,
  assets: string[],
) {
  const latestDate = await resolveEtfCommonLatest(assets);
  if (!latestDate || latestDate < policy.holdoutStart) {
    return null;
  }
  return {
    ...policy,
    latestDate,
    holdoutEnd: latestDate < policy.holdoutEnd ? latestDate : policy.holdoutEnd,
    checkedAt: new Date().toISOString(),
  };
}
