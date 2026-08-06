import type { FactorEvaluationScopeV1 } from '@jixie/shared';
import { minusDays } from '../lib/date.js';

export const MAX_INDEX_MEMBERSHIP_AGE_DAYS = 45;
export const WITHIN_INDUSTRY_MIN_GROUP_SIZE = 5;

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

export interface WithinGroupRankResult<T> {
  rows: T[];
  missingGroup: number;
  smallGroup: number;
  groups: number;
}

/** Convert raw values to comparable within-group percentile ranks. Missing classifications and groups
 * below the frozen minimum are excluded instead of being merged into an economically unrelated group. */
export function rankWithinGroups<T extends { value: number }>(
  rows: T[],
  groupKeys: Array<string | null>,
  minimumGroupSize = WITHIN_INDUSTRY_MIN_GROUP_SIZE,
): WithinGroupRankResult<T> {
  if (rows.length !== groupKeys.length) {
    throw new Error('Rows and group keys must have the same length.');
  }
  const indexesByGroup = new Map<string, number[]>();
  let missingGroup = 0;
  for (let index = 0; index < rows.length; index++) {
    const key = groupKeys[index];
    if (!key) {
      missingGroup += 1;
      continue;
    }
    const indexes = indexesByGroup.get(key) ?? [];
    indexes.push(index);
    indexesByGroup.set(key, indexes);
  }

  const rankedValues = new Map<number, number>();
  let smallGroup = 0;
  let groups = 0;
  for (const indexes of indexesByGroup.values()) {
    if (indexes.length < minimumGroupSize) {
      smallGroup += indexes.length;
      continue;
    }
    groups += 1;
    const ordered = indexes.slice().sort((a, b) => rows[a].value - rows[b].value);
    let start = 0;
    while (start < ordered.length) {
      let end = start;
      while (
        end + 1 < ordered.length &&
        rows[ordered[end + 1]].value === rows[ordered[start]].value
      ) {
        end += 1;
      }
      const percentile = ((start + end) / 2 + 0.5) / ordered.length;
      for (let position = start; position <= end; position++) {
        rankedValues.set(ordered[position], percentile);
      }
      start = end + 1;
    }
  }

  return {
    rows: rows.flatMap((row, index) => {
      const value = rankedValues.get(index);
      return value == null ? [] : [{ ...row, value }];
    }),
    missingGroup,
    smallGroup,
    groups,
  };
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
