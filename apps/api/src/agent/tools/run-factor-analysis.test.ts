import type { FactorReport, RunFactorAnalysisResponse } from '@jixie/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

vi.mock('#infra/database/prisma.js', async () => {
  const mocked = {
    prisma: {
      factor: { findFirst: mocks.findFirst },
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

import { runFactorAnalysisTool } from './run-factor-analysis.js';

const report = {
  periods: 48,
  icMean: 0.04,
  icirAnnual: 1.1,
  icPosRate: 0.64,
  longShort: { annReturn: 0.12 },
  longShortNet: { annReturn: 0.08, sharpe: 0.9, maxDrawdown: -0.15 },
  topTurnover: 0.32,
  methodology: { dataCutoff: '20260730' },
} as FactorReport;

describe('runFactorAnalysisTool', () => {
  beforeEach(() => {
    mocks.findFirst.mockReset();
    mocks.findFirst.mockResolvedValue({ id: 'factor-1', name: '盈利质量' });
  });

  it('freezes a V6 report and returns compact metrics', async () => {
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
      start,
      wait,
    });

    const result = await tool.run({
      code: 'candidate factor code',
      freq: 'month',
      start: '20200101',
      end: '20260730',
      neutral: 'size_industry',
    });

    expect(start).toHaveBeenCalledOnce();
    expect(start.mock.calls[0][0]).toMatchObject({
      userId: 'user-1',
      factor: 'factor-1',
      source: { code: 'candidate factor code', label: '盈利质量' },
      spec: {
        version: 6,
        freq: 'month',
        start: '20200101',
        end: '20260730',
        neutral: 'size_industry',
      },
    });
    expect(wait).toHaveBeenCalledWith('user-1', 'report-1', undefined);
    expect(JSON.parse(result.observation)).toMatchObject({
      reportId: 'report-1',
      status: 'done',
      metrics: {
        rankIcMean: 0.04,
        rankIcAnnual: 1.1,
        netLongShortAnnualized: 0.08,
      },
    });
  });

  it('freezes a V6 point-in-time scope for index-universe research', async () => {
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
      start,
      wait,
    });

    await tool.run({
      freq: 'month',
      start: '20200101',
      end: '20260730',
      neutral: 'none',
      universe: '000300.SH',
    });

    expect(start.mock.calls[0][0]).toMatchObject({
      spec: {
        version: 6,
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

  it('freezes within-industry ranking for all-A research in V6', async () => {
    const started: RunFactorAnalysisResponse = {
      reportId: 'report-industry',
      jobId: 'job-industry',
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
      start,
      wait,
    });

    await tool.run({
      freq: 'month',
      start: '20200101',
      end: '20260730',
      neutral: 'none',
      universe: 'cn_a',
      rankingScope: 'within_industry',
      diagnostics: ['industry'],
    });

    expect(start.mock.calls[0][0]).toMatchObject({
      spec: {
        version: 6,
        evaluationScope: {
          universe: { kind: 'market', market: 'cn_a' },
          rankingScope: 'within_industry',
          diagnostics: ['industry'],
        },
      },
    });
  });
});
