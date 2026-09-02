import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  backtestReportFindFirst: vi.fn(),
  agentConversationCreate: vi.fn(),
  researchDocumentCreate: vi.fn(),
  transaction: vi.fn(),
  getResearchDocument: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    backtestReport: { findFirst: mocks.backtestReportFindFirst },
    $transaction: mocks.transaction,
  },
}));
vi.mock('./workbench.js', () => ({
  getResearchDocument: mocks.getResearchDocument,
}));

import { createResearchDocumentFromBacktestReport } from './backtest-report-document.js';

describe('BacktestReport to Research document handoff', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.backtestReportFindFirst.mockResolvedValue({
      id: 'report-a',
      strategyName: '价值轮动',
    });
    mocks.transaction.mockImplementation((callback) =>
      callback({
        agentConversation: { create: mocks.agentConversationCreate },
        researchDocument: { create: mocks.researchDocumentCreate },
      }),
    );
    mocks.getResearchDocument.mockResolvedValue({ id: 'document-a' });
  });

  it('creates a document with an exact immutable report lookup', async () => {
    const result = await createResearchDocumentFromBacktestReport('user-a', 'report-a');

    expect(result).toEqual({ id: 'document-a' });
    expect(mocks.backtestReportFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'report-a', userId: 'user-a', status: 'done' }),
      }),
    );
    expect(mocks.agentConversationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-a',
        surface: 'research',
        title: '价值轮动 · 回测复核',
      }),
    });
    const cells = mocks.researchDocumentCreate.mock.calls[0][0].data.cells.create;
    expect(cells).toEqual([
      expect.objectContaining({ kind: 'markdown', position: 0 }),
      expect.objectContaining({
        kind: 'python',
        position: 1,
        source: 'backtest_report = results.backtest_report("report-a")\nbacktest_report',
      }),
    ]);
  });

  it('does not create a document for a report outside the owner scope', async () => {
    mocks.backtestReportFindFirst.mockResolvedValue(null);

    await expect(
      createResearchDocumentFromBacktestReport('user-a', 'report-b'),
    ).resolves.toBeNull();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
