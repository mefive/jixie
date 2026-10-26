import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  conversationFindFirst: vi.fn(),
  scanFindFirst: vi.fn(),
}));

vi.mock('#infra/database/prisma.js', async () => {
  const mocked = {
    prisma: {
      agentConversation: { findFirst: mocks.conversationFindFirst },
      strategyScanReport: { findFirst: mocks.scanFindFirst },
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

import { loadResearchStrategyScanReportResult } from './strategy-scan-report.js';

describe('Research read-only result datasets', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.conversationFindFirst.mockResolvedValue({
      userId: 'owner',
      researchDocument: { id: 'document' },
    });
  });

  it('returns a completed owner-scoped parameter scan without rerunning it', async () => {
    mocks.scanFindFirst.mockResolvedValue({
      id: 'scan-1',
      strategyId: 'strategy-1',
      strategyName: 'Rotation',
      legacyStatus: null,
      legacyError: null,
      job: { status: 'done', error: null },
      settings: { name: 'Rotation', start: '20200101', end: '20251231', initialCash: 1_000_000 },
      spec: { splitDate: '20240101' },
      dataCutoff: '20260731',
      payload: { parameters: { windowSize: 20 }, cells: [] },
      createdAt: new Date('2026-08-01T00:00:00Z'),
      updatedAt: new Date('2026-08-01T01:00:00Z'),
    });

    const result = await loadResearchStrategyScanReportResult('document', 'scan-1');

    expect(mocks.scanFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'scan-1', userId: 'owner' } }),
    );
    expect(result).toMatchObject({
      report_id: 'scan-1',
      data_cutoff: '20260731',
      settings: { initial_cash: 1_000_000 },
      report: { parameters: { window_size: 20 }, cells: [] },
    });
  });

  it('rejects incomplete or cross-user results', async () => {
    mocks.scanFindFirst.mockResolvedValue(null);
    await expect(loadResearchStrategyScanReportResult('document', 'other')).rejects.toThrow(
      'not found',
    );

    mocks.scanFindFirst.mockResolvedValue({ job: { status: 'running' } });
    await expect(loadResearchStrategyScanReportResult('document', 'scan-1')).rejects.toThrow(
      'not complete',
    );
  });
});
