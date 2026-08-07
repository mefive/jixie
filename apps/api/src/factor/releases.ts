import type { FactorReport as FactorReportPayload, FactorResearchIntentV1 } from '@jixie/shared';
import type {
  FactorAnalysisKind,
  FactorInputDomain,
  FactorRelease as FactorReleaseResource,
  FactorReleaseMaturity,
  FactorReleaseMethodologyV1,
  FactorOutputScope,
  FactorTargetAssetClass,
  PublishFactorReleaseRequest,
} from '@jixie/shared';
import type {
  FactorRelease as FactorReleaseRow,
  FactorReport as FactorReportRow,
  Prisma,
} from '@prisma/client';
import { ulid } from 'ulid';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { BUILTIN_KEYS, BUILTIN_USER_ID } from './builtin-factors.js';

const FACTOR_KEY_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

export const publishFactorReleaseBodySchema = z.object({
  sourceKind: z.enum(['single', 'composite']),
  sourceId: z.string().trim().min(1).max(80),
  releaseKey: z.string().trim().regex(FACTOR_KEY_PATTERN).optional(),
  approvedReportId: z.string().trim().min(1).max(80),
  inputDomains: z
    .array(z.enum(['price', 'fundamental', 'flow', 'rates', 'commodity', 'macro']))
    .min(1)
    .max(6)
    .optional(),
  targetAssetClasses: z
    .array(z.enum(['equity', 'fixed_income', 'commodity', 'cash', 'fx']))
    .min(1)
    .max(5)
    .optional(),
  outputScope: z.enum(['asset', 'global']).optional(),
  maturity: z.enum(['experimental', 'validated', 'production']),
});

export type FactorReleaseErrorReason =
  | 'source_not_found'
  | 'key_required'
  | 'key_unavailable'
  | 'report_invalid'
  | 'validation_required'
  | 'production_not_ready'
  | 'input_dependencies_unknown'
  | 'metadata_mismatch';

export class FactorReleaseError extends Error {
  constructor(readonly reason: FactorReleaseErrorReason) {
    super(reason);
    this.name = 'FactorReleaseError';
  }
}

interface ReleaseValidationReport {
  status: string;
  phase: string;
  revealedAt: Date | null;
  payload: string | null;
  researchIntentJson: string | null;
}

export interface DerivedFactorReleaseMetadata {
  inputDomains: FactorInputDomain[];
  targetAssetClasses: FactorTargetAssetClass[];
  outputScope: FactorOutputScope;
}

export function assertReleaseMaturity(
  report: ReleaseValidationReport,
  maturity: FactorReleaseMaturity,
): void {
  if (maturity === 'production') {
    throw new FactorReleaseError('production_not_ready');
  }
  if (report.status !== 'done' || (report.phase === 'holdout' && !report.revealedAt)) {
    throw new FactorReleaseError('report_invalid');
  }
  if (maturity === 'experimental') {
    return;
  }

  const payload = parseJson<FactorReportPayload>(report.payload);
  const intent = parseJson<FactorResearchIntentV1>(report.researchIntentJson);
  if (
    report.phase !== 'holdout' ||
    !report.revealedAt ||
    !payload ||
    !intent?.primaryCriterion ||
    !criterionPassed(payload, intent)
  ) {
    throw new FactorReleaseError('validation_required');
  }
}

export async function publishFactorRelease(
  userId: string,
  request: PublishFactorReleaseRequest,
): Promise<FactorReleaseResource> {
  const source = await resolveSource(userId, request);
  const report = await prisma.factorReport.findFirst({
    where: {
      id: request.approvedReportId,
      userId,
      factor: request.sourceId,
      status: 'done',
    },
  });
  if (!report?.factorCodeSnapshot || !report.factorCodeHash) {
    throw new FactorReleaseError('report_invalid');
  }
  assertReleaseMaturity(report, request.maturity);
  const metadata = deriveFactorReleaseMetadata(
    request.sourceKind,
    report.factorCodeSnapshot,
    analysisKind(report.analysisKind),
  );
  assertReleaseMetadata(request, metadata);

  const releaseKey = await resolveReleaseKey(userId, request, source.releaseKey);
  const methodologySnapshot = methodologyFor(report);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const row = await prisma.$transaction(async (transaction) => {
        const latest = await transaction.factorRelease.findFirst({
          where: { userId, releaseKey },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        return transaction.factorRelease.create({
          data: {
            id: ulid(),
            userId,
            factorId: request.sourceKind === 'single' ? request.sourceId : null,
            compositeId: request.sourceKind === 'composite' ? request.sourceId : null,
            sourceRef: request.sourceId,
            releaseKey,
            version: (latest?.version ?? 0) + 1,
            sourceKind: request.sourceKind,
            sourceName: source.name,
            inputDomains: metadata.inputDomains,
            targetAssetClasses: metadata.targetAssetClasses,
            outputScope: metadata.outputScope,
            codeSnapshot: report.factorCodeSnapshot!,
            codeHash: report.factorCodeHash!,
            approvedReportId: report.id,
            methodologySnapshot: methodologySnapshot as unknown as Prisma.InputJsonValue,
            maturity: request.maturity,
          },
        });
      });
      return releaseResource(row);
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002' || attempt === 2) {
        throw error;
      }
    }
  }
  throw new FactorReleaseError('key_unavailable');
}

/** Derive the publish contract from the exact source bytes approved by the report. This is the
 * compatibility adapter for the equity Factor SDK; future research protocols must expose typed
 * inputs before their releases are enabled. */
export function deriveFactorReleaseMetadata(
  sourceKind: PublishFactorReleaseRequest['sourceKind'],
  snapshot: string,
  kind: FactorAnalysisKind,
): DerivedFactorReleaseMetadata {
  if (kind !== 'cross_sectional') {
    throw new FactorReleaseError('input_dependencies_unknown');
  }

  const sources = sourceKind === 'single' ? [snapshot] : compositeComponentSources(snapshot);
  const domains = new Set<FactorInputDomain>();
  for (const source of sources) {
    collectSourceDomains(source, domains);
  }
  if (domains.size === 0) {
    throw new FactorReleaseError('input_dependencies_unknown');
  }
  return {
    inputDomains: [...domains].sort(),
    targetAssetClasses: ['equity'],
    outputScope: 'asset',
  };
}

export function assertReleaseMetadata(
  claim: Pick<PublishFactorReleaseRequest, 'inputDomains' | 'targetAssetClasses' | 'outputScope'>,
  derived: DerivedFactorReleaseMetadata,
): void {
  if (
    (claim.inputDomains && !sameMembers(claim.inputDomains, derived.inputDomains)) ||
    (claim.targetAssetClasses &&
      !sameMembers(claim.targetAssetClasses, derived.targetAssetClasses)) ||
    (claim.outputScope && claim.outputScope !== derived.outputScope)
  ) {
    throw new FactorReleaseError('metadata_mismatch');
  }
}

function compositeComponentSources(snapshot: string): string[] {
  try {
    const parsed = JSON.parse(snapshot) as { components?: Array<{ code?: unknown }> };
    const sources = parsed.components?.flatMap((component) =>
      typeof component.code === 'string' ? [component.code] : [],
    );
    if (sources?.length) {
      return sources;
    }
  } catch {
    // The immutable snapshot is validated when the report is created. A malformed legacy snapshot
    // must fail closed at publication instead of receiving guessed metadata.
  }
  throw new FactorReleaseError('input_dependencies_unknown');
}

function collectSourceDomains(source: string, domains: Set<FactorInputDomain>): void {
  const barFields = new Set(
    [...source.matchAll(/\bbar\s*\.\s*([A-Za-z][A-Za-z0-9_]*)/g)].map((match) => match[1]),
  );
  for (const match of source.matchAll(/ctx\s*\.\s*history\s*\(([^)]*)\)/g)) {
    const args = match[1];
    if (/['"`](roe|grossprofitMargin)['"`]/.test(args)) {
      domains.add('fundamental');
    } else {
      domains.add('price');
    }
  }

  if (hasAny(barFields, ['totalMv', 'circMv', 'turnoverRate'])) {
    domains.add('price');
  }
  if (hasAny(barFields, ['pe', 'peTtm', 'pb', 'ps', 'psTtm', 'dvRatio', 'dvTtm'])) {
    domains.add('price');
    domains.add('fundamental');
  }
  if (hasAny(barFields, ['roe', 'grossprofitMargin', 'debtToAssets'])) {
    domains.add('fundamental');
  }
  if (hasAny(barFields, ['netMain', 'netTotal'])) {
    domains.add('flow');
  }
}

function hasAny(values: Set<string>, candidates: string[]): boolean {
  return candidates.some((candidate) => values.has(candidate));
}

function sameMembers<T extends string>(left: T[], right: T[]): boolean {
  return [...new Set(left)].sort().join('\0') === [...new Set(right)].sort().join('\0');
}

export async function listFactorReleases(userId: string): Promise<FactorReleaseResource[]> {
  const rows = await prisma.factorRelease.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(releaseResource);
}

export async function getFactorRelease(
  userId: string,
  id: string,
): Promise<FactorReleaseResource | null> {
  const row = await prisma.factorRelease.findFirst({ where: { id, userId } });
  return row ? releaseResource(row) : null;
}

export async function retireFactorRelease(
  userId: string,
  id: string,
): Promise<FactorReleaseResource | null> {
  const updated = await prisma.factorRelease.updateMany({
    where: { id, userId },
    data: { lifecycle: 'retired' },
  });
  return updated.count === 0 ? null : getFactorRelease(userId, id);
}

async function resolveSource(
  userId: string,
  request: PublishFactorReleaseRequest,
): Promise<{ name: string; releaseKey?: string }> {
  if (request.sourceKind === 'single') {
    const factor = await prisma.factor.findFirst({
      where: { id: request.sourceId, userId: { in: [userId, BUILTIN_USER_ID] } },
      select: { id: true, userId: true, key: true, name: true },
    });
    if (!factor) {
      throw new FactorReleaseError('source_not_found');
    }
    const releaseKey = factor.userId === BUILTIN_USER_ID ? factor.id : factor.key;
    if (!releaseKey) {
      throw new FactorReleaseError('key_required');
    }
    return { name: factor.name, releaseKey };
  }

  const composite = await prisma.factorComposite.findFirst({
    where: { id: request.sourceId, userId },
    select: { name: true },
  });
  if (!composite) {
    throw new FactorReleaseError('source_not_found');
  }
  const existing = await prisma.factorRelease.findFirst({
    where: { userId, sourceKind: 'composite', sourceRef: request.sourceId },
    orderBy: { version: 'desc' },
    select: { releaseKey: true },
  });
  return { name: composite.name, releaseKey: existing?.releaseKey };
}

async function resolveReleaseKey(
  userId: string,
  request: PublishFactorReleaseRequest,
  lockedKey?: string,
): Promise<string> {
  const releaseKey = lockedKey ?? request.releaseKey;
  if (!releaseKey) {
    throw new FactorReleaseError('key_required');
  }
  if (lockedKey && request.releaseKey && request.releaseKey !== lockedKey) {
    throw new FactorReleaseError('key_unavailable');
  }

  const conflictingRelease = await prisma.factorRelease.findFirst({
    where: {
      userId,
      releaseKey,
      NOT: { sourceKind: request.sourceKind, sourceRef: request.sourceId },
    },
    select: { id: true },
  });
  if (conflictingRelease) {
    throw new FactorReleaseError('key_unavailable');
  }

  if (request.sourceKind === 'composite') {
    if (BUILTIN_KEYS.has(releaseKey)) {
      throw new FactorReleaseError('key_unavailable');
    }
    const factor = await prisma.factor.findFirst({
      where: { userId, key: releaseKey },
      select: { id: true },
    });
    if (factor) {
      throw new FactorReleaseError('key_unavailable');
    }
  }
  return releaseKey;
}

function methodologyFor(report: FactorReportRow): FactorReleaseMethodologyV1 {
  return {
    version: 1,
    analysisKind: analysisKind(report.analysisKind),
    phase:
      report.phase === 'explore' || report.phase === 'holdout' ? report.phase : ('legacy' as const),
    approvedReportId: report.id,
    spec: parseJson(report.specJson) ?? {
      version: 1,
      freq: report.freq,
      start: report.start,
      end: report.end,
      neutral: report.neutral,
    },
    ...(parseJson<FactorResearchIntentV1>(report.researchIntentJson)
      ? { researchIntent: parseJson<FactorResearchIntentV1>(report.researchIntentJson)! }
      : {}),
    ...(report.revealedAt ? { revealedAt: report.revealedAt.toISOString() } : {}),
  };
}

function releaseResource(row: FactorReleaseRow): FactorReleaseResource {
  return {
    id: row.id,
    releaseKey: row.releaseKey,
    version: row.version,
    sourceKind: row.sourceKind === 'composite' ? 'composite' : 'single',
    sourceId: row.sourceRef,
    sourceName: row.sourceName,
    inputDomains: row.inputDomains as FactorReleaseResource['inputDomains'],
    targetAssetClasses: row.targetAssetClasses as FactorReleaseResource['targetAssetClasses'],
    outputScope: row.outputScope === 'global' ? 'global' : 'asset',
    codeHash: row.codeHash,
    approvedReportId: row.approvedReportId,
    methodology: row.methodologySnapshot as unknown as FactorReleaseMethodologyV1,
    maturity:
      row.maturity === 'validated' || row.maturity === 'production' ? row.maturity : 'experimental',
    lifecycle: row.lifecycle === 'retired' ? 'retired' : 'active',
    createdAt: row.createdAt.toISOString(),
  };
}

function criterionPassed(report: FactorReportPayload, intent: FactorResearchIntentV1): boolean {
  const criterion = intent.primaryCriterion;
  if (!criterion) {
    return false;
  }
  const value = {
    rank_ic_mean: report.icMean,
    rank_icir_annual: report.icirAnnual,
    net_long_short_annualized: report.longShortNet?.annReturn ?? Number.NaN,
    time_series_median_newey_west_t: Number.NaN,
    time_series_mean_direction_hit_rate: Number.NaN,
  }[criterion.metric];
  return (
    Number.isFinite(value) &&
    (criterion.operator === 'gt' ? value > criterion.value : value < criterion.value)
  );
}

function analysisKind(value: string): FactorAnalysisKind {
  return value === 'time_series' || value === 'panel' || value === 'macro_regime'
    ? value
    : 'cross_sectional';
}

function parseJson<T = unknown>(value: string | null): T | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}
