import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  conversationFindFirst: vi.fn(),
  factorReportFindFirst: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    agentConversation: { findFirst: mocks.conversationFindFirst },
    factorReport: { findFirst: mocks.factorReportFindFirst },
  },
}));

import { loadResearchFactorReportResult } from './factor-report-result.js';

describe('Research FactorReport result bridge', () => {
  beforeEach(() => {
    mocks.conversationFindFirst.mockReset().mockResolvedValue({
      userId: 'user-a',
      researchDocument: { id: 'document-a' },
    });
    mocks.factorReportFindFirst.mockReset().mockResolvedValue(factorReportRow());
  });

  it('maps one immutable owned report into the snake_case Research surface', async () => {
    const result = await loadResearchFactorReportResult('document-a', 'report-a');

    expect(mocks.conversationFindFirst).toHaveBeenCalledWith({
      where: { id: 'document-a', surface: 'research', archivedAt: null },
      select: { userId: true, researchDocument: { select: { id: true } } },
    });
    expect(mocks.factorReportFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'report-a', userId: 'user-a' } }),
    );
    expect(result).toMatchObject({
      version: 1,
      report_id: 'report-a',
      factor: 'value',
      analysis_kind: 'cross_sectional',
      status: 'done',
      phase: 'explore',
      language: 'python',
      runtime_version: 'py-v1',
      research_spec: {
        version: 1,
        analysis_kind: 'cross_sectional',
        protocol: { freq: 'month', start: '20200101', end: '20251231' },
      },
      research_intent: { expected_direction: 'positive' },
      lineage: {
        factor_code_hash: 'code-hash',
        data_revision: 'data-revision',
        parent_report_id: null,
      },
      report: { ic_mean: 0.05, robust_inference: { newey_west_t_stat: 2.1 } },
    });
  });

  it('does not resolve reports outside the Research document owner scope', async () => {
    mocks.factorReportFindFirst.mockResolvedValue(null);

    await expect(loadResearchFactorReportResult('document-a', 'report-b')).rejects.toThrow(
      'Factor report was not found.',
    );
    expect(mocks.factorReportFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'report-b', userId: 'user-a' } }),
    );
  });

  it('keeps an unrevealed holdout sealed', async () => {
    mocks.factorReportFindFirst.mockResolvedValue(
      factorReportRow({ phase: 'holdout', revealedAt: null }),
    );

    await expect(loadResearchFactorReportResult('document-a', 'report-a')).rejects.toThrow(
      'Factor holdout report is sealed',
    );
  });
});

function factorReportRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'report-a',
    factor: 'value',
    status: 'done',
    phase: 'explore',
    language: 'python',
    freq: 'month',
    neutral: 'none',
    start: '20200101',
    end: '20251231',
    specJson: JSON.stringify({
      version: 1,
      freq: 'month',
      start: '20200101',
      end: '20251231',
      neutral: 'none',
    }),
    payload: JSON.stringify({
      icMean: 0.05,
      robustInference: { neweyWestTStat: 2.1 },
    }),
    factorCodeHash: 'code-hash',
    dataRevision: 'data-revision',
    parentReportId: null,
    researchIntentJson: JSON.stringify({
      version: 1,
      mode: 'hypothesis',
      expectedDirection: 'positive',
    }),
    revealedAt: new Date('2026-08-31T08:00:00Z'),
    createdAt: new Date('2026-08-30T08:00:00Z'),
    computedAt: new Date('2026-08-30T08:05:00Z'),
    ...overrides,
  };
}
