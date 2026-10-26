import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  backtestReportFindFirst: vi.fn(),
  agentConversationCreate: vi.fn(),
  researchDocumentCreate: vi.fn(),
  transaction: vi.fn(),
  getResearchDocument: vi.fn(),
}));

vi.mock('#infra/database/prisma.js', async () => {
  const mocked = {
    prisma: {
      backtestReport: { findFirst: mocks.backtestReportFindFirst },
      $transaction: mocks.transaction,
    },
  };
  return {
    ...(await vi.importActual<typeof import('#infra/database/prisma.js')>(
      '#infra/database/prisma.js',
    )),
    ...mocked,
    getDatabase: () => mocked.prisma,
  };
});
vi.mock('./read.js', () => ({
  getResearchDocument: mocks.getResearchDocument,
}));

import { createResearchDocumentFromBacktestReport } from './from-backtest-report.js';

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

  it('creates a document with an exact retained report lookup', async () => {
    const result = await createResearchDocumentFromBacktestReport('user-a', 'report-a', 'zh');

    expect(result).toEqual({ id: 'document-a' });
    expect(mocks.backtestReportFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'report-a',
          userId: 'user-a',
          AND: [
            {
              OR: [
                { job: { is: { status: { in: ['done'] } } } },
                { job: { is: null }, legacyStatus: { in: ['done'] } },
              ],
            },
          ],
        }),
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

  it('describes retained-report expiry in English when requested', async () => {
    await createResearchDocumentFromBacktestReport('user-a', 'report-a', 'en');

    expect(mocks.agentConversationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ title: '价值轮动 · Backtest review' }),
    });
    const markdown = mocks.researchDocumentCreate.mock.calls[0][0].data.cells.create[0].source;
    expect(markdown).toContain('old ID will fail');
    expect(markdown).toContain('report-a');
  });

  it('does not create a document for a report outside the owner scope', async () => {
    mocks.backtestReportFindFirst.mockResolvedValue(null);

    await expect(
      createResearchDocumentFromBacktestReport('user-a', 'report-b', 'en'),
    ).rejects.toMatchObject({ reason: 'backtest_report_not_found' });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
