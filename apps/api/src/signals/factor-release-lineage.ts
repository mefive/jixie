import type { FactorReleaseDependency } from '@jixie/shared';

const MATURITIES = new Set(['experimental', 'validated', 'production']);

/** Parse the immutable dependency snapshot stored in Prisma JSON. Null denotes a legacy row. */
export function factorReleaseDependenciesFromJson(
  value: unknown,
): FactorReleaseDependency[] | null {
  if (value == null) {
    return null;
  }
  if (!Array.isArray(value)) {
    throw new Error('Invalid factor release dependency snapshot');
  }
  return value.map((item) => {
    if (
      !isRecord(item) ||
      !isNonEmptyString(item.releaseId) ||
      !isNonEmptyString(item.sourceId) ||
      !isNonEmptyString(item.releaseKey) ||
      !Number.isInteger(item.version) ||
      (item.version as number) < 1 ||
      !isNonEmptyString(item.codeHash) ||
      !isNonEmptyString(item.approvedReportId) ||
      typeof item.maturity !== 'string' ||
      !MATURITIES.has(item.maturity)
    ) {
      throw new Error('Invalid factor release dependency snapshot');
    }
    return item as unknown as FactorReleaseDependency;
  });
}

/** Fail closed if persisted lineage and freshly resolved immutable releases diverge. */
export function assertFactorReleaseDependencies(
  expected: FactorReleaseDependency[] | null,
  actual: FactorReleaseDependency[],
): void {
  if (expected == null) {
    return;
  }
  if (canonicalJson(expected) !== canonicalJson(actual)) {
    throw new Error('Factor release dependency snapshot mismatch');
  }
}

function canonicalJson(dependencies: FactorReleaseDependency[]): string {
  return JSON.stringify(
    [...dependencies]
      .sort((left, right) => left.releaseId.localeCompare(right.releaseId))
      .map((dependency) => ({
        releaseId: dependency.releaseId,
        sourceId: dependency.sourceId,
        releaseKey: dependency.releaseKey,
        version: dependency.version,
        codeHash: dependency.codeHash,
        approvedReportId: dependency.approvedReportId,
        maturity: dependency.maturity,
      })),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
