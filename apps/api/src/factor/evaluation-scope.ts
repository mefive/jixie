import type { FactorEvaluationScopeV1 } from '@jixie/shared';
import { minusDays } from '../lib/date.js';

export const MAX_INDEX_MEMBERSHIP_AGE_DAYS = 45;

export interface IndexMembershipRow {
  conCode: string;
  tradeDate: string;
}

/** Point-in-time index membership built from dated constituent snapshots. A decision date can only
 * see the latest snapshot on or before that date; a future snapshot is never used as a fallback. */
export class PointInTimeIndexMembership {
  private readonly dates: string[];
  private readonly membersByDate = new Map<string, Set<string>>();

  constructor(rows: IndexMembershipRow[]) {
    for (const row of rows) {
      const members = this.membersByDate.get(row.tradeDate) ?? new Set<string>();
      members.add(row.conCode);
      this.membersByDate.set(row.tradeDate, members);
    }
    this.dates = [...this.membersByDate.keys()].sort();
  }

  at(date: string): Set<string> | null {
    return this.resolve(date)?.members ?? null;
  }

  resolve(date: string): { snapshotDate: string; members: Set<string> } | null {
    let low = 0;
    let high = this.dates.length - 1;
    let found = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (this.dates[middle] <= date) {
        found = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    if (found < 0) {
      return null;
    }
    const snapshotDate = this.dates[found];
    return { snapshotDate, members: this.membersByDate.get(snapshotDate)! };
  }
}

/** Keep a dated universe fail-closed when the upstream constituent history has stopped updating. */
export function isIndexMembershipFresh(snapshotDate: string, decisionDate: string): boolean {
  return snapshotDate >= minusDays(decisionDate, MAX_INDEX_MEMBERSHIP_AGE_DAYS);
}

export function filterEvaluationUniverse<T extends { tsCode: string }>(
  rows: T[],
  scope: FactorEvaluationScopeV1,
  date: string,
  indexMembership?: PointInTimeIndexMembership,
): { rows: T[]; universeSize: number; hasSnapshot: boolean; snapshotDate?: string } {
  if (scope.universe.kind === 'market') {
    return { rows, universeSize: rows.length, hasSnapshot: true };
  }
  const snapshot = indexMembership?.resolve(date);
  if (!snapshot) {
    return { rows: [], universeSize: 0, hasSnapshot: false };
  }
  return {
    rows: rows.filter((row) => snapshot.members.has(row.tsCode)),
    universeSize: snapshot.members.size,
    hasSnapshot: true,
    snapshotDate: snapshot.snapshotDate,
  };
}
