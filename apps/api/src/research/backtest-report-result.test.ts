import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  conversationFindFirst: vi.fn(),
  backtestReportFindFirst: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    agentConversation: { findFirst: mocks.conversationFindFirst },
    backtestReport: { findFirst: mocks.backtestReportFindFirst },
  },
}));

import { loadResearchBacktestReportResult } from './backtest-report-result.js';

describe('Research BacktestReport result bridge', () => {
  beforeEach(() => {
    mocks.conversationFindFirst.mockReset().mockResolvedValue({
      userId: 'user-a',
      researchDocument: { id: 'document-a' },
    });
    mocks.backtestReportFindFirst.mockReset().mockResolvedValue(backtestReportRow());
  });

  it('maps one immutable owned report into the snake_case Research surface', async () => {
    const result = await loadResearchBacktestReportResult('document-a', 'report-a');

    expect(mocks.backtestReportFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'report-a', userId: 'user-a' } }),
    );
    expect(result).toMatchObject({
      version: 1,
      report_id: 'report-a',
      strategy_id: 'strategy-a',
      strategy_name: '价值轮动',
      status: 'done',
      backtest_spec: {
        start: '20200101',
        end: '20251231',
        initial_cash: 1_000_000,
        language: 'python',
        runtime_version: 'py-v1',
      },
      lineage: { code_hash: 'code-hash', result_hash: 'result-hash' },
      report: {
        total_return: 0.32,
        sharpe: 1.2,
        max_drawdown: -0.18,
        nav: [{ date: '20200102', value: 1_000_000 }],
      },
    });
  });

  it('does not resolve reports outside the Research document owner scope', async () => {
    mocks.backtestReportFindFirst.mockResolvedValue(null);

    await expect(loadResearchBacktestReportResult('document-a', 'report-b')).rejects.toThrow(
      'Backtest report was not found.',
    );
  });

  it('rejects reports that are not complete', async () => {
    mocks.backtestReportFindFirst.mockResolvedValue(backtestReportRow({ status: 'running' }));

    await expect(loadResearchBacktestReportResult('document-a', 'report-a')).rejects.toThrow(
      'Backtest report is not complete: running.',
    );
  });
});

function backtestReportRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'report-a',
    strategyId: 'strategy-a',
    strategyName: '价值轮动',
    status: 'done',
    config: {
      name: '价值轮动',
      start: '20200101',
      end: '20251231',
      initialCash: 1_000_000,
      language: 'python',
      runtimeVersion: 'py-v1',
      code: 'class Strategy: pass',
    },
    codeHash: 'code-hash',
    resultHash: 'result-hash',
    payload: {
      totalReturn: 0.32,
      sharpe: 1.2,
      maxDrawdown: -0.18,
      nav: [{ date: '20200102', value: 1_000_000 }],
    },
    createdAt: new Date('2026-08-30T08:00:00Z'),
    computedAt: new Date('2026-08-30T08:05:00Z'),
    ...overrides,
  };
}
