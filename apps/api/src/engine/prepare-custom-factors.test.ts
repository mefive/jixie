import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  factorFindMany: vi.fn(),
  releaseFindMany: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    factor: { findMany: mocks.factorFindMany },
    factorRelease: { findMany: mocks.releaseFindMany },
  },
}));

import { prepareStrategyFactors } from './prepare-custom-factors.js';

const RELEASE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const SOURCE = `export default defineFactor({ compute: (bar) => bar.pb });`;

function release(overrides: Record<string, unknown> = {}) {
  return {
    id: RELEASE_ID,
    releaseKey: 'book_to_market',
    sourceRef: 'factor-1',
    version: 2,
    sourceKind: 'single',
    codeSnapshot: SOURCE,
    codeHash: 'abc123',
    approvedReportId: 'report-1',
    maturity: 'validated',
    lifecycle: 'active',
    ...overrides,
  };
}

describe('immutable factor release preparation', () => {
  beforeEach(() => {
    mocks.factorFindMany.mockReset().mockResolvedValue([]);
    mocks.releaseFindMany.mockReset().mockResolvedValue([release()]);
  });

  it('loads the exact owned release snapshot and records run lineage', async () => {
    const prepared = await prepareStrategyFactors(
      `factors: ['release:${RELEASE_ID}']`,
      'user-1',
      'zh',
    );

    expect(mocks.releaseFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [RELEASE_ID] }, userId: 'user-1' } }),
    );
    expect(prepared.modules).toHaveLength(1);
    expect(prepared.modules[0]).toMatchObject({ key: `release:${RELEASE_ID}` });
    expect(prepared.modules[0].js).toContain('defineFactor');
    expect(prepared.releases).toEqual([
      {
        releaseId: RELEASE_ID,
        sourceId: 'factor-1',
        releaseKey: 'book_to_market',
        version: 2,
        codeHash: 'abc123',
        approvedReportId: 'report-1',
        maturity: 'validated',
      },
    ]);
  });

  it('requires active production releases for daily signals', async () => {
    mocks.releaseFindMany.mockResolvedValue([release({ maturity: 'experimental' })]);
    await expect(
      prepareStrategyFactors(`release:${RELEASE_ID}`, 'user-1', 'en', 'production'),
    ).rejects.toThrow(/active production/);
  });

  it('fails closed for foreign, deleted, and composite releases', async () => {
    mocks.releaseFindMany.mockResolvedValue([]);
    await expect(prepareStrategyFactors(`release:${RELEASE_ID}`, 'user-1', 'en')).rejects.toThrow(
      `release:${RELEASE_ID}`,
    );

    mocks.releaseFindMany.mockResolvedValue([release({ sourceKind: 'composite' })]);
    await expect(prepareStrategyFactors(`release:${RELEASE_ID}`, 'user-1', 'en')).rejects.toThrow(
      /runtime type/,
    );
  });
});
