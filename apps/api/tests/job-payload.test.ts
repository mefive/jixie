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
import { factorAnalysisWorkerInputSchema } from '#factor/execution/worker-input.js';
import {
  factorCorrelationJobPayloadSchema,
  type FactorCorrelationJobPayload,
} from '#factor/correlations/job-payload.js';
import {
  signalsRunJobPayloadSchema,
  type SignalsRunJobPayload,
} from '#signals/runs/job-payload.js';
import {
  researchEmbeddedAnalysisJobPayloadSchema,
  type ResearchEmbeddedAnalysisJobPayload,
} from '#research/embedded/job-payload.js';
import {
  researchCuratorJobPayloadSchema,
  type ResearchCuratorJobPayload,
} from '#research/curator/job-payload.js';
import { submitStrategyScanSchema } from '@jixie/shared/api/strategy';
import { createDefaultFactorAnalysisSpecV3 } from '#factor/execution/spec.js';

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
const correlation = {
  id: 'correlation',
  userId: 'owner',
  keys: ['value', 'quality'],
  freq: 'month',
  start: '20240101',
  end: '20241231',
  locale: 'en',
} satisfies FactorCorrelationJobPayload;
const signal = { task: 'signal', runId: 'signal', locale: 'en' } satisfies SignalsRunJobPayload;
const embedded = { runId: 'embedded' } satisfies ResearchEmbeddedAnalysisJobPayload;
const curator = { runId: 'curator' } satisfies ResearchCuratorJobPayload;

describe('durable Job payload and Worker input contracts', () => {
  it.each([
    ['backtest', backtestJobPayloadSchema, backtest],
    ['scan', strategyScanJobPayloadSchema, scan],
    ['analysis', factorAnalysisJobPayloadSchema, analysis],
    ['correlation', factorCorrelationJobPayloadSchema, correlation],
    ['signal', signalsRunJobPayloadSchema, signal],
    ['embedded', researchEmbeddedAnalysisJobPayloadSchema, embedded],
    ['curator', researchCuratorJobPayloadSchema, curator],
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

  it('accepts formal and weather inputs without requiring Job-only fields in the Worker', () => {
    const { failedMessage: _failureMessage, ...formal } = analysis;
    const weather = { ...formal, reportId: 'weather:value', spec: protocol };
    expect(factorAnalysisWorkerInputSchema.parse(formal)).toEqual(formal);
    expect(factorAnalysisWorkerInputSchema.parse(weather)).toEqual(weather);
    expect(
      factorAnalysisJobPayloadSchema.parse({ ...weather, failedMessage: analysis.failedMessage })
        .spec,
    ).toEqual(analysis.spec);
    expect(factorAnalysisJobPayloadSchema.safeParse(weather).success).toBe(false);
    expect(
      factorAnalysisWorkerInputSchema.safeParse({
        ...weather,
        source: { kind: 'single', label: 'Value' },
      }).success,
    ).toBe(false);
  });

  it('rejects malformed identifiers and preserves strict Research payloads', () => {
    expect(signalsRunJobPayloadSchema.safeParse({ ...signal, runId: '' }).success).toBe(false);
    expect(signalsRunJobPayloadSchema.safeParse({ ...signal, locale: 'fr' }).success).toBe(false);
    expect(
      factorCorrelationJobPayloadSchema.safeParse({ ...correlation, keys: ['value'] }).success,
    ).toBe(false);
    expect(
      researchEmbeddedAnalysisJobPayloadSchema.safeParse({ ...embedded, unexpected: true }).success,
    ).toBe(false);
    expect(
      researchCuratorJobPayloadSchema.safeParse({ ...curator, unexpected: true }).success,
    ).toBe(false);
  });
});
