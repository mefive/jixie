import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  backtestJobPayloadSchema,
  backtestWorkerInputSchema,
  type BacktestJobPayload,
  type BacktestWorkerInput,
} from '#strategy/backtests/job-payload.js';
import {
  strategyScanJobPayloadSchema,
  strategyScanWorkerInputSchema,
  type StrategyScanJobPayload,
  type StrategyScanWorkerInput,
} from '#strategy/scans/job-payload.js';
import {
  factorAnalysisJobPayloadSchema,
  type FactorAnalysisJobPayload,
} from '#factor/evaluations/job-payload.js';
import { factorAnalysisWorkerInputSchema } from '#factor/analysis/worker-input.js';
import {
  researchEmbeddedAnalysisJobPayloadSchema,
  type ResearchEmbeddedAnalysisJobPayload,
} from '#research/embedded/job-payload.js';
import { submitStrategyScanSchema } from '@jixie/shared/api/strategy';
import { createDefaultFactorAnalysisSpecV3 } from '#factor/analysis/spec.js';

const backtest = {
  task: 'backtest',
  reportId: 'report',
  strategyId: 'strategy',
  userId: 'owner',
  locale: 'en',
  config: {
    name: 'Fixture',
    start: '20240101',
    end: '20241231',
    initialCash: 100_000,
    code: 'fixture',
  },
} satisfies BacktestJobPayload;
const scan = {
  task: 'strategy-scan',
  reportId: 'scan',
  userId: 'owner',
  locale: 'en',
  config: backtest.config,
  spec: { dimensions: [{ key: 'window', values: [10, 20] }], view: 'parameters' },
  parameters: { window: 10 },
  ranges: {
    inSample: { start: '20240101', end: '20240630' },
    outOfSample: { start: '20240701', end: '20241231' },
  },
} satisfies StrategyScanJobPayload;
const protocol = createDefaultFactorAnalysisSpecV3({
  freq: 'month',
  start: '20240101',
  end: '20241231',
  neutral: 'none',
});
const analysis = {
  reportId: 'analysis',
  factor: 'value',
  source: { kind: 'single', code: 'fixture', label: 'Value' },
  spec: { version: 1, analysisKind: 'cross_sectional', protocol },
  locale: 'en',
  failedMessage: 'Analysis failed',
} satisfies FactorAnalysisJobPayload;
const embedded = {
  runId: 'embedded',
  source: '1',
  parameters: {},
  revision: 1,
} satisfies ResearchEmbeddedAnalysisJobPayload;

describe('durable Job payload and Worker input contracts', () => {
  it.each([
    ['backtest', backtestJobPayloadSchema, backtest],
    ['scan', strategyScanJobPayloadSchema, scan],
    ['analysis', factorAnalysisJobPayloadSchema, analysis],
    ['embedded', researchEmbeddedAnalysisJobPayloadSchema, embedded],
  ] as const)(
    'preserves the typed %s submission through JSON storage',
    (_name, schema, payload) => {
      expect(schema.parse(JSON.parse(JSON.stringify(payload)))).toEqual(payload);
      expect(schema.safeParse({}).success).toBe(false);
    },
  );

  it('derives Worker subsets without duplicating their fields', () => {
    expectTypeOf<BacktestWorkerInput>().toEqualTypeOf<
      Omit<BacktestJobPayload, 'task' | 'reportId'>
    >();
    expectTypeOf<StrategyScanWorkerInput>().toEqualTypeOf<
      Omit<StrategyScanJobPayload, 'task' | 'reportId'>
    >();
    const { task: _backtestTask, reportId: _backtestReport, ...backtestInput } = backtest;
    const { task: _scanTask, reportId: _scanReport, ...scanInput } = scan;
    expect(backtestWorkerInputSchema.parse(backtest)).toEqual(backtestInput);
    expect(strategyScanWorkerInputSchema.parse(scan)).toEqual(scanInput);
    expect(
      strategyScanWorkerInputSchema.safeParse({
        ...scanInput,
        ranges: { inSample: scan.ranges.inSample },
      }).success,
    ).toBe(false);
    expect(
      strategyScanWorkerInputSchema.safeParse({ ...scanInput, parameters: { window: true } })
        .success,
    ).toBe(false);
  });

  it('keeps scan HTTP bounds separate from the stored normalized shape', () => {
    const normalized = { ...scan, spec: { dimensions: [], view: 'parameters' } };
    expect(strategyScanJobPayloadSchema.safeParse(normalized).success).toBe(true);
    expect(submitStrategyScanSchema.safeParse(normalized).success).toBe(false);
    const request = {
      config: scan.config,
      spec: { dimensions: [{ key: 'mode', values: [' fast ', 'slow'] }] },
    };
    expect(submitStrategyScanSchema.parse(request).spec.dimensions[0].values).toEqual([
      'fast',
      'slow',
    ]);
  });

  it('accepts current and legacy protocols without requiring Job-only fields in the Worker', () => {
    const { failedMessage: _failureMessage, ...formal } = analysis;
    const legacy = { ...formal, reportId: 'legacy:value', spec: protocol };
    expect(factorAnalysisWorkerInputSchema.parse(formal)).toEqual(formal);
    expect(factorAnalysisWorkerInputSchema.parse(legacy)).toEqual(legacy);
    expect(
      factorAnalysisJobPayloadSchema.parse({ ...legacy, failedMessage: analysis.failedMessage })
        .spec,
    ).toEqual(analysis.spec);
    expect(factorAnalysisJobPayloadSchema.safeParse(legacy).success).toBe(false);
    expect(
      factorAnalysisWorkerInputSchema.safeParse({
        ...legacy,
        source: { kind: 'single', label: 'Value' },
      }).success,
    ).toBe(false);
  });

  it('rejects malformed identifiers and preserves strict Research payloads', () => {
    expect(
      researchEmbeddedAnalysisJobPayloadSchema.safeParse({ ...embedded, unexpected: true }).success,
    ).toBe(false);
  });
});
