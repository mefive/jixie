import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256 } from './report-spec.js';

const mocks = vi.hoisted(() => ({
  factorFindFirst: vi.fn(),
  reportFindFirst: vi.fn(),
  factorUpdateMany: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    factor: {
      findFirst: mocks.factorFindFirst,
      updateMany: mocks.factorUpdateMany,
    },
    factorReport: { findFirst: mocks.reportFindFirst },
  },
}));

import { FactorPublicationError, publishFactor } from './publication.js';

const CODE = `export default defineFactor({ compute: (bar) => bar.pb });`;

describe('immutable Factor publication', () => {
  beforeEach(() => {
    mocks.factorFindFirst.mockReset().mockResolvedValue({
      id: 'factor-1',
      key: 'book_to_market',
      name: 'Book to market',
      code: CODE,
      analysisKind: 'cross_sectional',
      status: 'draft',
    });
    mocks.reportFindFirst.mockReset().mockResolvedValue({
      id: 'report-1',
      analysisKind: 'cross_sectional',
      phase: 'explore',
      revealedAt: null,
      factorCodeSnapshot: CODE,
      factorCodeHash: sha256(CODE),
    });
    mocks.factorUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  });

  it('locks the factor against the exact approved report snapshot', async () => {
    const published = await publishFactor('user-1', 'factor-1', 'report-1');

    expect(mocks.factorUpdateMany).toHaveBeenCalledWith({
      where: { id: 'factor-1', userId: 'user-1', status: 'draft' },
      data: expect.objectContaining({
        status: 'published',
        approvedReportId: 'report-1',
        codeHash: sha256(CODE),
      }),
    });
    expect(published).toMatchObject({
      id: 'factor-1',
      key: 'book_to_market',
      status: 'published',
      approvedReportId: 'report-1',
    });
  });

  it('rejects an outdated report snapshot', async () => {
    mocks.reportFindFirst.mockResolvedValue({
      id: 'report-1',
      analysisKind: 'cross_sectional',
      phase: 'explore',
      revealedAt: null,
      factorCodeSnapshot: `${CODE}\n`,
      factorCodeHash: sha256(`${CODE}\n`),
    });

    await expect(publishFactor('user-1', 'factor-1', 'report-1')).rejects.toEqual(
      new FactorPublicationError('report_outdated'),
    );
  });

  it('rejects already published factors', async () => {
    mocks.factorFindFirst.mockResolvedValue({
      id: 'factor-1',
      key: 'book_to_market',
      name: 'Book to market',
      code: CODE,
      analysisKind: 'cross_sectional',
      status: 'published',
    });

    await expect(publishFactor('user-1', 'factor-1', 'report-1')).rejects.toEqual(
      new FactorPublicationError('not_draft'),
    );
  });

  it('rejects a sealed holdout report', async () => {
    mocks.reportFindFirst.mockResolvedValue({
      id: 'report-1',
      analysisKind: 'cross_sectional',
      phase: 'holdout',
      revealedAt: null,
      factorCodeSnapshot: CODE,
      factorCodeHash: sha256(CODE),
    });

    await expect(publishFactor('user-1', 'factor-1', 'report-1')).rejects.toEqual(
      new FactorPublicationError('report_invalid'),
    );
  });
});
