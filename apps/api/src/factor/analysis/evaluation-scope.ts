import type { FactorEvaluationScopeV1 } from '@jixie/shared';
import { minusDays } from '#date';

export const MAX_INDEX_MEMBERSHIP_AGE_DAYS = 45;
export const WITHIN_INDUSTRY_MIN_GROUP_SIZE = 5;

/**
 * 提供带日期的指数成员，供评估证券池时点解析。
 *
 * Supply dated index members for evaluation-universe selection.
 */
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

  /**
   * 按评估日期解析可用证券池及成员分类，供时点求值和组内排名。
   *
   * Resolve the dated evaluation universe and memberships for point-in-time computation and within-group ranking.
   */
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

/**
 * 在指数成分历史停止更新时拒绝使用陈旧证券池。
 *
 * Keep a dated universe fail-closed when the upstream constituent history has stopped updating.
 */
export function isIndexMembershipFresh(snapshotDate: string, decisionDate: string): boolean {
  return snapshotDate >= minusDays(decisionDate, MAX_INDEX_MEMBERSHIP_AGE_DAYS);
}

/**
 * 返回组内排名与覆盖诊断，供跨资产可比较值构造。
 *
 * Return within-group ranks and coverage diagnostics for comparable cross-asset values.
 */
export interface WithinGroupRankResult<T> {
  rows: T[];
  missingGroup: number;
  smallGroup: number;
  groups: number;
}

/**
 * 将原始数值转换为组内分位排名；缺失分类和不足规模的组遵守冻结政策。
 *
 * Convert raw values to comparable within-group percentile ranks. Missing classifications and groups
 * below the frozen minimum are excluded instead of being merged into an economically unrelated group.
 */
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

/**
 * 按冻结范围与时点成员过滤评估证券，保留缺失成员处理。
 *
 * Filter evaluation instruments under the frozen dated universe.
 */
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
