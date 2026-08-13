import type { ResearchUniverseRowV1, UniverseSpecV1 } from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import { applyUniverseSpec } from './universe.js';

const baseSpec: UniverseSpecV1 = {
  version: 1,
  source: { kind: 'equity_market', market: 'CN' },
  asOf: { kind: 'latest_available' },
  eligibility: { minimumListedDays: 0, suspension: 'exclude', riskWarning: 'include' },
  predicates: [{ measure: 'equity.pe_ttm', measureVersion: 1, op: '<', value: 20 }],
  missing: 'exclude',
  sort: { measure: 'equity.total_market_cap_cny_10k', measureVersion: 1, direction: 'desc' },
  select: [{ measure: 'equity.pe_ttm', measureVersion: 1 }],
  limit: 2,
};

describe('applyUniverseSpec', () => {
  it('excludes missing predicates, sorts deterministically, and reports pre-limit total', () => {
    const rows: ResearchUniverseRowV1[] = [
      row('A', 12, 100),
      row('B', null, 500),
      row('C', 8, 300),
      row('D', 18, 200),
    ];
    const result = applyUniverseSpec(rows, baseSpec);
    expect(result.total).toBe(3);
    expect(result.rows.map((item) => item.entity.id)).toEqual(['C', 'D']);
  });

  it('supports equality and always places null sort values last', () => {
    const spec: UniverseSpecV1 = {
      ...baseSpec,
      predicates: [{ measure: 'equity.pe_ttm', measureVersion: 1, op: '==', value: 12 }],
      sort: { measure: 'equity.total_market_cap_cny_10k', measureVersion: 1, direction: 'asc' },
      limit: 10,
    };
    const result = applyUniverseSpec([row('B', 12, null), row('A', 12, 100)], spec);
    expect(result.rows.map((item) => item.entity.id)).toEqual(['A', 'B']);
  });
});

function row(id: string, peTtm: number | null, marketCap: number | null): ResearchUniverseRowV1 {
  return {
    entity: { assetType: 'stock', id },
    name: id,
    industry: null,
    values: {
      'equity.pe_ttm': peTtm,
      'equity.total_market_cap_cny_10k': marketCap,
    },
  };
}
