import type { PrismaClient } from '@prisma/client';
import type { EventStudyPlanSpecV1 } from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import { executeResearchPlan } from './executor.js';
import { parseResearchPlanSpec } from './spec.js';

describe('event-study protocol', () => {
  it('validates an explicit dividend-announcement event set and market benchmark', () => {
    expect(parseResearchPlanSpec(eventStudyPlan())).toMatchObject({
      question: { kind: 'event_study' },
      protocol: { kind: 'event_study', returnModel: 'market_adjusted' },
    });
  });

  it('rejects unsupported event entities, benchmark semantics, and missing evidence', () => {
    const unsupportedEntity = eventStudyPlan();
    unsupportedEntity.inputs[0].source.entities[0]!.assetType = 'index';
    expect(() => parseResearchPlanSpec(unsupportedEntity)).toThrow('stock entities only');

    const invalidBenchmark = eventStudyPlan();
    invalidBenchmark.inputs[1].transform = 'level';
    expect(() => parseResearchPlanSpec(invalidBenchmark)).toThrow(
      'must use market.adjusted_close simple_return',
    );

    const missingPath = eventStudyPlan();
    missingPath.outputs = missingPath.outputs.filter((output) => output.kind !== 'event_path');
    expect(() => parseResearchPlanSpec(missingPath)).toThrow('outputs must include event_path');
  });

  it('maps public announcement dates to trading days and computes a market-adjusted event path', async () => {
    const run = await executeResearchPlan(eventStudyPlan(), { database: fixtureDatabase() });

    expect(run.result.kind).toBe('event_study');
    expect(run.result.observations).toBe(10);
    expect(run.result.path.map((point) => point.relativeDay)).toEqual([-1, 0, 1]);
    expect(run.result.aggregate.meanCumulativeAbnormalReturn).toBeGreaterThan(0.015);
    expect(run.result.aggregate.eventDateClusters).toBe(5);
    expect(run.result.aggregate.confidenceInterval95.lower).toBeGreaterThan(0);
    expect(run.result.events[0]).toMatchObject({
      announcementDate: '20240110',
      eventTradeDate: '20240110',
    });
    expect(run.coverage[0]).toMatchObject({
      eventsLoaded: 11,
      eventsWithCompleteWindow: 11,
      overlappingEventsExcluded: 1,
      eventsAnalyzed: 10,
    });
    expect(run.conclusion).toMatchObject({
      level: 'weak_support',
      direction: 'positive',
      intervalExcludesNull: true,
      robustness: { assessment: 'consistent' },
    });
    expect(run.conclusion.rationaleCodes).toContain('small_event_sample');
    expect(run.conclusion.limitationsEn[0]).toContain('not a causal counterfactual');
    expect(run.fingerprints?.data.inputs).toEqual([
      expect.objectContaining({ inputId: 'benchmark', observations: 30 }),
      expect.objectContaining({ inputId: 'dividendEvents', observations: 10 }),
    ]);
  });

  it('rejects event samples below the protocol minimum after overlap and coverage filtering', async () => {
    const plan = eventStudyPlan();
    plan.inputs[0].source.entities = plan.inputs[0].source.entities.slice(0, 4);
    await expect(executeResearchPlan(plan, { database: fixtureDatabase() })).rejects.toThrow(
      'requires at least 5 complete non-overlapping events',
    );
  });
});

function eventStudyPlan(): EventStudyPlanSpecV1 {
  return {
    version: 1,
    question: {
      version: 1,
      kind: 'event_study',
      text: '分红预案首次公告附近是否存在正向异常收益？',
      hypothesis: {
        estimand: 'mean_cumulative_abnormal_return',
        direction: 'positive',
        nullValue: 0,
      },
    },
    start: '20240101',
    end: '20240131',
    inputs: [
      {
        type: 'event_set',
        id: 'dividendEvents',
        source: {
          kind: 'dividend_proposal_announcement',
          entities: Array.from({ length: 10 }, (_, index) => ({
            assetType: 'stock',
            id: `A${String(index).padStart(3, '0')}`,
          })),
        },
        label: '分红预案首次公告',
      },
      {
        type: 'series',
        id: 'benchmark',
        source: { kind: 'instrument', assetType: 'index', id: '000300.SH' },
        measure: 'market.adjusted_close',
        transform: 'simple_return',
        label: '沪深300',
      },
    ],
    protocol: {
      kind: 'event_study',
      version: 1,
      eventSet: 'dividendEvents',
      benchmark: 'benchmark',
      eventWindow: { start: -1, end: 1 },
      returnModel: 'market_adjusted',
      overlappingEvents: 'keep_first',
      inference: {
        kind: 'event_cluster_mean',
        clusterBy: 'event_trade_date',
        confidenceLevel: 0.95,
      },
    },
    outputs: [
      { kind: 'summary_table' },
      { kind: 'event_path' },
      { kind: 'event_table' },
      { kind: 'sensitivity' },
      { kind: 'conclusion' },
      { kind: 'formula' },
      { kind: 'python_example' },
      { kind: 'documentation' },
    ],
  };
}

function fixtureDatabase(): PrismaClient {
  const dates = Array.from(
    { length: 20 },
    (_, index) => `202401${String(index + 2).padStart(2, '0')}`,
  );
  const codes = Array.from({ length: 10 }, (_, index) => `A${String(index).padStart(3, '0')}`);
  const dividends = codes.map((tsCode, index) => ({
    id: `event-${index}`,
    tsCode,
    annDate: `202401${String(Math.floor(index / 2) + 10).padStart(2, '0')}`,
    endDate: '20231231',
    divProc: '预案',
  }));
  dividends.push({
    id: 'later-stage',
    tsCode: 'A000',
    annDate: '20240112',
    endDate: '20231231',
    divProc: '预案',
  });
  dividends.push({
    id: 'overlap',
    tsCode: 'A000',
    annDate: '20240111',
    endDate: '20230630',
    divProc: '预案',
  });
  const daily = codes.flatMap((tsCode, codeIndex) => {
    let close = 100;
    return dates.map((tradeDate) => {
      if (tradeDate === `202401${String(Math.floor(codeIndex / 2) + 10).padStart(2, '0')}`) {
        close *= 1.02 + codeIndex * 0.002;
      }
      return { tsCode, tradeDate, close };
    });
  });
  const adjustments = daily.map((row) => ({
    tsCode: row.tsCode,
    tradeDate: row.tradeDate,
    adjFactor: 1,
  }));
  const database = {
    dividend: {
      findMany: async (args: { where: { tsCode: { in: string[] } } }) =>
        dividends.filter((row) => args.where.tsCode.in.includes(row.tsCode)),
    },
    tradeCal: {
      findMany: async () => dates.map((calDate) => ({ calDate })),
    },
    indexDaily: {
      findMany: async () => dates.map((tradeDate) => ({ tradeDate, close: 100 })),
    },
    daily: { findMany: async () => daily },
    adjFactor: { findMany: async () => adjustments },
    etfDaily: { findMany: async () => [] },
    etfAdjFactor: { findMany: async () => [] },
  };
  return database as unknown as PrismaClient;
}
