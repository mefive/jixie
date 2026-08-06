import type { FactorEvaluationScopeV1 } from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import {
  filterEvaluationUniverse,
  isIndexMembershipFresh,
  PointInTimeIndexMembership,
} from './evaluation-scope.js';

const scope: FactorEvaluationScopeV1 = {
  version: 1,
  universe: { kind: 'index', indexCode: '000300.SH' },
  membership: 'point_in_time',
  rankingScope: 'global',
  diagnostics: [],
};

describe('factor evaluation scope', () => {
  it('uses the latest index snapshot known on the decision date', () => {
    const membership = new PointInTimeIndexMembership([
      { tradeDate: '20240131', conCode: 'A' },
      { tradeDate: '20240131', conCode: 'B' },
      { tradeDate: '20240229', conCode: 'B' },
      { tradeDate: '20240229', conCode: 'C' },
    ]);
    const candidates = [{ tsCode: 'A' }, { tsCode: 'B' }, { tsCode: 'C' }];

    expect(filterEvaluationUniverse(candidates, scope, '20240215', membership)).toEqual({
      rows: [{ tsCode: 'A' }, { tsCode: 'B' }],
      universeSize: 2,
      hasSnapshot: true,
      snapshotDate: '20240131',
    });
    expect(filterEvaluationUniverse(candidates, scope, '20240301', membership).rows).toEqual([
      { tsCode: 'B' },
      { tsCode: 'C' },
    ]);
  });

  it('never backfills an early decision date from a future constituent snapshot', () => {
    const membership = new PointInTimeIndexMembership([{ tradeDate: '20240131', conCode: 'A' }]);

    expect(filterEvaluationUniverse([{ tsCode: 'A' }], scope, '20240115', membership)).toEqual({
      rows: [],
      universeSize: 0,
      hasSnapshot: false,
    });
  });

  it('rejects snapshots older than the frozen 45-day freshness boundary', () => {
    expect(isIndexMembershipFresh('20240101', '20240215')).toBe(true);
    expect(isIndexMembershipFresh('20240101', '20240216')).toBe(false);
  });
});
