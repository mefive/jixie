import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ reportFindFirst: vi.fn() }));

vi.mock('#infra/database/prisma.js', () => ({
  prisma: { factorReport: { findFirst: mocks.reportFindFirst } },
}));

import { readFactorAnalysisResult } from './read.js';

describe('readFactorAnalysisResult', () => {
  it('owner-scopes and parses a completed explore payload', async () => {
    mocks.reportFindFirst.mockResolvedValue({
      status: 'done',
      error: null,
      payload: JSON.stringify({ factor: 'factor-1', icMean: 0.03 }),
    });

    const result = await readFactorAnalysisResult('user-1', 'report-1');

    expect(mocks.reportFindFirst).toHaveBeenCalledWith({
      where: { id: 'report-1', userId: 'user-1', phase: 'explore' },
      select: { status: true, error: true, payload: true },
    });
    expect(result).toMatchObject({ status: 'done', payload: { icMean: 0.03 } });
  });
});
