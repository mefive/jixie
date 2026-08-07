import type { FactorDependency } from '@jixie/shared';

/** Parse the immutable dependency snapshot stored in Prisma JSON. */
export function factorDependenciesFromJson(value: unknown): FactorDependency[] | null {
  if (value == null) {
    return null;
  }
  if (!Array.isArray(value)) {
    throw new Error('Invalid factor dependency snapshot');
  }
  return value.map((item) => {
    if (
      !isRecord(item) ||
      !isNonEmptyString(item.factorId) ||
      !isNonEmptyString(item.key) ||
      !isNonEmptyString(item.name) ||
      !isNonEmptyString(item.analysisKind) ||
      !isNonEmptyString(item.codeHash) ||
      (item.approvedReportId != null && !isNonEmptyString(item.approvedReportId))
    ) {
      throw new Error('Invalid factor dependency snapshot');
    }
    return item as unknown as FactorDependency;
  });
}

/** Fail closed if persisted lineage and freshly resolved factors diverge. */
export function assertFactorDependencies(
  expected: FactorDependency[] | null,
  actual: FactorDependency[],
): void {
  if (expected == null) {
    return;
  }
  if (canonicalJson(expected) !== canonicalJson(actual)) {
    throw new Error('Factor dependency snapshot mismatch');
  }
}

function canonicalJson(dependencies: FactorDependency[]): string {
  return JSON.stringify(
    [...dependencies]
      .sort((left, right) => left.factorId.localeCompare(right.factorId))
      .map((dependency) => ({
        factorId: dependency.factorId,
        key: dependency.key,
        name: dependency.name,
        analysisKind: dependency.analysisKind,
        codeHash: dependency.codeHash,
        approvedReportId: dependency.approvedReportId ?? null,
      })),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
