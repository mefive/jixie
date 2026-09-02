import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  conversationFindFirst: vi.fn(),
  scanFindFirst: vi.fn(),
  weatherFindFirst: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    agentConversation: { findFirst: mocks.conversationFindFirst },
    strategyScanReport: { findFirst: mocks.scanFindFirst },
    factorWeatherPin: { findFirst: mocks.weatherFindFirst },
  },
}));

import {
  loadResearchFactorWeatherResult,
  loadResearchStrategyScanReportResult,
} from './result-dataset.js';

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
      status: 'done',
      config: { initialCash: 1_000_000 },
      spec: { splitDate: '20240101' },
      codeHash: 'code-hash',
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
      config: { initial_cash: 1_000_000 },
      report: { parameters: { window_size: 20 }, cells: [] },
    });
  });

  it('returns stored owner-scoped factor weather observations and metadata', async () => {
    mocks.weatherFindFirst.mockResolvedValue({
      factorId: 'factor-1',
      factorName: 'Momentum',
      direction: 'positive',
      status: 'ready',
      computedThrough: '20260731',
      factorCodeHash: 'factor-hash',
      points: [
        {
          formationDate: '20260630',
          periodEndDate: '20260731',
          rankIc: 0.1,
          topReturn: 0.03,
          bottomReturn: -0.01,
          longShortGrossReturn: 0.04,
          longShortNetReturn: 0.035,
          topTurnover: 0.2,
          sampleSize: 300,
          sampleCoverage: 0.95,
        },
      ],
    });

    const result = await loadResearchFactorWeatherResult('document', 'factor-1');

    expect(mocks.weatherFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'owner', factorId: 'factor-1' } }),
    );
    expect(result.rows).toEqual([
      expect.objectContaining({
        formation_date: '20260630',
        period_end_date: '20260731',
        long_short_net_return: 0.035,
      }),
    ]);
    expect(result.metadata).toMatchObject({ factor_id: 'factor-1', code_hash: 'factor-hash' });
  });

  it('rejects incomplete or cross-user results', async () => {
    mocks.scanFindFirst.mockResolvedValue(null);
    await expect(loadResearchStrategyScanReportResult('document', 'other')).rejects.toThrow(
      'not found',
    );

    mocks.weatherFindFirst.mockResolvedValue({ status: 'running' });
    await expect(loadResearchFactorWeatherResult('document', 'factor-1')).rejects.toThrow(
      'not ready',
    );
  });
});
