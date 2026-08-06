import type { FactorReport as FactorReportPayload, FactorResearchIntentV1 } from '@jixie/shared';
import type {
  FactorAnalysisKind,
  FactorRelease as FactorReleaseResource,
  FactorReleaseMaturity,
  FactorReleaseMethodologyV1,
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
    .array(z.enum(['price', 'fundamental', 'rates', 'commodity', 'macro']))
    .min(1)
    .max(5),
  targetAssetClasses: z
    .array(z.enum(['equity', 'fixed_income', 'commodity', 'cash', 'fx']))
    .min(1)
    .max(5),
  outputScope: z.enum(['asset', 'global']),
  maturity: z.enum(['experimental', 'validated', 'production']),
});

export type FactorReleaseErrorReason =
  | 'source_not_found'
  | 'key_required'
  | 'key_unavailable'
  | 'report_invalid'
  | 'validation_required'
  | 'production_not_ready';

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
            inputDomains: request.inputDomains,
            targetAssetClasses: request.targetAssetClasses,
            outputScope: request.outputScope,
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
  }[criterion.metric];
  return criterion.operator === 'gt' ? value > criterion.value : value < criterion.value;
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
