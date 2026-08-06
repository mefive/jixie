import type { FactorHoldoutPolicyV1, FactorReport, RunFactorAnalysisResponse } from '@jixie/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    factor: { findFirst: mocks.findFirst },
  },
}));

import { runFactorAnalysisTool } from './run-factor-analysis.js';

const policy: FactorHoldoutPolicyV1 = {
  version: 1,
  months: 18,
  latestDate: '20260730',
  exploreEnd: '20260130',
  holdoutStart: '20260202',
  holdoutEnd: '20260730',
  checkedAt: '2026-07-31T00:00:00.000Z',
};

const report = {
  periods: 48,
  icMean: 0.04,
  icirAnnual: 1.1,
  icPosRate: 0.64,
  longShort: { annReturn: 0.12 },
  longShortNet: { annReturn: 0.08, sharpe: 0.9, maxDrawdown: -0.15 },
  topTurnover: 0.32,
  methodology: { dataCutoff: '20260130' },
} as FactorReport;

const intent = {
  version: 1 as const,
  mode: 'hypothesis' as const,
  hypothesis: 'Higher profitability should predict higher forward returns.',
  rationale: 'Profitable firms may sustain quality premia.',
  expectedDirection: 'positive' as const,
  primaryCriterion: {
    metric: 'rank_ic_mean' as const,
    operator: 'gt' as const,
    value: 0.02,
  },
};

describe('runFactorAnalysisTool', () => {
  beforeEach(() => {
    mocks.findFirst.mockReset();
    mocks.findFirst.mockResolvedValue({ id: 'factor-1', name: '盈利质量' });
  });

  it('freezes a V3 explore report and returns compact metrics', async () => {
    const started: RunFactorAnalysisResponse = {
      reportId: 'report-1',
      jobId: 'job-1',
      status: 'running',
      reusedRunning: false,
    };
    const start = vi.fn(async (_options: unknown) => started);
    const wait = vi.fn(async (_userId: string, _reportId: string, _signal?: AbortSignal) => ({
      status: 'done' as const,
      payload: report,
    }));
    const tool = runFactorAnalysisTool({
      userId: 'user-1',
      factorId: 'factor-1',
      currentCode: 'current factor code',
      locale: 'zh',
      getPolicy: async () => policy,
      start,
      wait,
    });

    const result = await tool.run({
      code: 'candidate factor code',
      freq: 'month',
      start: '20200101',
      end: '20260130',
      neutral: 'size_industry',
      researchIntent: intent,
    });

    expect(start).toHaveBeenCalledOnce();
    expect(start.mock.calls[0][0]).toMatchObject({
      userId: 'user-1',
      factor: 'factor-1',
      source: { code: 'candidate factor code', label: '盈利质量' },
      spec: {
        version: 3,
        freq: 'month',
        start: '20200101',
        end: '20260130',
        neutral: 'size_industry',
      },
      researchIntent: intent,
    });
    expect(wait).toHaveBeenCalledWith('user-1', 'report-1', undefined);
    expect(JSON.parse(result.observation)).toMatchObject({
      phase: 'explore',
      reportId: 'report-1',
      status: 'done',
      metrics: {
        rankIcMean: 0.04,
        rankIcAnnual: 1.1,
        netLongShortAnnualized: 0.08,
      },
      holdoutBoundary: {
        exploreEnd: '20260130',
        holdoutStart: '20260202',
      },
    });
  });

  it('freezes a V5 point-in-time scope for index-universe research', async () => {
    const started: RunFactorAnalysisResponse = {
      reportId: 'report-index',
      jobId: 'job-index',
      status: 'running',
      reusedRunning: false,
    };
    const start = vi.fn(async (_options: unknown) => started);
    const wait = vi.fn(async () => ({ status: 'done' as const, payload: report }));
    const tool = runFactorAnalysisTool({
      userId: 'user-1',
      factorId: 'factor-1',
      currentCode: 'current factor code',
      locale: 'zh',
      getPolicy: async () => policy,
      start,
      wait,
    });

    await tool.run({
      freq: 'month',
      start: '20200101',
      end: '20260130',
      neutral: 'none',
      universe: '000300.SH',
      researchIntent: intent,
    });

    expect(start.mock.calls[0][0]).toMatchObject({
      spec: {
        version: 5,
        evaluationScope: {
          version: 1,
          universe: { kind: 'index', indexCode: '000300.SH' },
          membership: 'point_in_time',
          rankingScope: 'global',
          diagnostics: [],
        },
      },
    });
  });

  it('rejects any sample that crosses into sealed holdout data', async () => {
    const start = vi.fn(async () => {
      throw new Error('should not run');
    });
    const tool = runFactorAnalysisTool({
      userId: 'user-1',
      factorId: 'factor-1',
      currentCode: 'current factor code',
      locale: 'zh',
      getPolicy: async () => policy,
      start,
    });

    await expect(
      tool.run({
        freq: 'month',
        start: '20200101',
        end: '20260202',
        researchIntent: intent,
      }),
    ).rejects.toThrow('crosses the sealed holdout');
    expect(start).not.toHaveBeenCalled();
  });

  it('requires a complete hypothesis card before starting a hypothesis run', async () => {
    const start = vi.fn(async () => {
      throw new Error('should not run');
    });
    const tool = runFactorAnalysisTool({
      userId: 'user-1',
      factorId: 'factor-1',
      currentCode: 'current factor code',
      locale: 'zh',
      getPolicy: async () => policy,
      start,
    });

    await expect(
      tool.run({
        freq: 'month',
        start: '20200101',
        end: '20260130',
        researchIntent: {
          version: 1,
          mode: 'hypothesis',
          expectedDirection: 'unknown',
        },
      }),
    ).rejects.toThrow('Invalid factor-analysis input');
    expect(start).not.toHaveBeenCalled();
  });
});
