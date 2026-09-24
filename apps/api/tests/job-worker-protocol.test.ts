import { describe, expect, expectTypeOf, it } from 'vitest';
import type { BacktestResult } from '#engine/types.js';
import type { z } from 'zod';
import type {
  BacktestSummary,
  StrategyScanPayload,
  SignalItem,
  ModelPositionSnapshot,
  FactorInputSummary,
} from '@jixie/shared';
import { backtestSummarySchema, backtestResultSchema } from '#strategy/backtests/result-schema.js';
import { backtestWorkerMessageSchema } from '#strategy/backtests/worker-protocol.js';
import { strategyScanPayloadSchema } from '#strategy/scans/result-schema.js';
import { strategyScanWorkerMessageSchema } from '#strategy/scans/worker-protocol.js';
import { factorAnalysisWorkerMessageSchema } from '#factor/execution/worker-protocol.js';
import { factorCorrelationWorkerMessageSchema } from '#factor/correlations/worker-protocol.js';
import { signalWorkerMessageSchema } from '#signals/runs/worker-protocol.js';
import {
  signalItemSchema,
  modelPositionSnapshotSchema,
  factorInputSummarySchema,
} from '#signals/runs/result-schema.js';

// Expand shared intersection aliases before comparing the complete nested wire shape.
type DataShape<Value> = Value extends object
  ? { [Key in keyof Value]: DataShape<Value[Key]> }
  : Value;

const summary: BacktestSummary = {
  name: 'Fixture',
  start: '20240101',
  end: '20240102',
  days: 2,
  initialCash: 100,
  finalValue: 101,
  totalReturn: 0.01,
  annReturn: 0.01,
  sharpe: 1,
  maxDrawdown: 0,
  trades: 0,
  tradeLog: [],
  nav: [{ date: '20240101', value: 100 }],
};

describe('shared Worker wire contracts', () => {
  it('keeps inferred result types aligned with public and engine contracts', () => {
    expectTypeOf<DataShape<z.infer<typeof backtestSummarySchema>>>().toEqualTypeOf<
      DataShape<BacktestSummary>
    >();
    expectTypeOf<DataShape<z.infer<typeof backtestResultSchema>>>().toEqualTypeOf<
      DataShape<BacktestResult>
    >();
    expectTypeOf<z.infer<typeof strategyScanPayloadSchema>>().toEqualTypeOf<StrategyScanPayload>();
    expectTypeOf<z.infer<typeof signalItemSchema>>().toEqualTypeOf<SignalItem>();
    expectTypeOf<
      z.infer<typeof modelPositionSnapshotSchema>
    >().toEqualTypeOf<ModelPositionSnapshot>();
    expectTypeOf<z.infer<typeof factorInputSummarySchema>>().toEqualTypeOf<FactorInputSummary>();
  });

  it.each([
    backtestWorkerMessageSchema,
    strategyScanWorkerMessageSchema,
    factorAnalysisWorkerMessageSchema,
    factorCorrelationWorkerMessageSchema,
    signalWorkerMessageSchema,
  ])('uses the same validated log and error envelope', (schema) => {
    const log = { type: 'log', entry: { source: 'system', level: 'info', text: 'progress' } };
    expect(schema.parse(log)).toEqual(log);
    expect(schema.parse({ type: 'error', message: 'failed' })).toEqual({
      type: 'error',
      message: 'failed',
    });
    expect(
      schema.safeParse({ type: 'log', entry: { source: 'system', level: 'invalid', text: 'bad' } })
        .success,
    ).toBe(false);
    expect(schema.safeParse({ type: 'done', payload: 123 }).success).toBe(false);
  });

  it('preserves nested optional backtest diagnostics and rejects invalid optional fields', () => {
    const payload: BacktestSummary = {
      ...summary,
      totalSlippage: 0.5,
      factorDependencies: [
        {
          factorId: 'factor',
          key: 'value',
          name: 'Value',
          analysisKind: 'time_series',
          codeHash: 'hash',
          language: 'python',
          inputs: ['close'],
        },
      ],
      allocationAnalysis: {
        version: 1,
        methodology: 'daily_component_pnl',
        riskMethodology: 'component_covariance',
        observations: 2,
        reconciliation: {
          portfolioPnl: 1,
          attributedNetPnl: 1,
          residual: 0,
          tolerance: 0.01,
          reconciled: true,
        },
        costs: { fees: 0, slippage: 0.5, total: 0.5 },
        assets: [],
        assetClasses: [],
        drift: [],
        risk: {
          version: 1,
          separationPolicy: 'daily_market_risk_and_monthly_macro_sensitivity',
          scenarios: [
            {
              key: 'historical',
              kind: 'historical',
              asOfDate: '20240102',
              historicalWindow: { startDate: '20200101', endDate: '20201231' },
              shocks: [{ factor: 'cn_equity', shock: -0.1, unit: 'decimal_return' }],
              estimatedReturnImpact: -0.02,
              methodology: 'linear_factor_shock',
            },
          ],
        },
      },
    };
    expect(backtestWorkerMessageSchema.parse({ type: 'done', payload })).toEqual({
      type: 'done',
      payload,
    });
    expect(
      backtestWorkerMessageSchema.safeParse({
        type: 'done',
        payload: { ...payload, totalSlippage: 'invalid' },
      }).success,
    ).toBe(false);
    expect(
      backtestWorkerMessageSchema.safeParse({
        type: 'done',
        payload: {
          ...payload,
          allocationAnalysis: { ...payload.allocationAnalysis, observations: 'invalid' },
        },
      }).success,
    ).toBe(false);
  });

  it('validates scan metrics and rejects malformed scan results', () => {
    const payload = {
      parameters: { window: 20 },
      cells: [{ params: { window: 20 }, nav: [{ date: '20240101', value: 1 }] }],
    };
    expect(strategyScanWorkerMessageSchema.parse({ type: 'done', payload })).toEqual({
      type: 'done',
      payload,
    });
    expect(
      strategyScanWorkerMessageSchema.safeParse({
        type: 'done',
        payload: { ...payload, cells: [{ params: {}, full: { sharpe: 'bad' } }] },
      }).success,
    ).toBe(false);
    expect(
      strategyScanWorkerMessageSchema.safeParse({
        type: 'done',
        payload: { parameters: { flag: true }, cells: [] },
      }).success,
    ).toBe(false);
  });

  it('retains Signals conditional orders and T+1 frozen quantities', () => {
    const output = {
      dataCutoff: '20240102',
      modelEquity: 100,
      modelCash: 50,
      modelPositions: [
        {
          code: 'stock',
          name: 'Stock',
          assetType: 'stock',
          shares: 100,
          markPrice: 1,
          sellableFrom: '20240103',
          frozenShares: 50,
        },
      ],
      signals: [
        {
          code: 'stock',
          name: 'Stock',
          assetType: 'stock',
          action: 'sell',
          shares: 50,
          refPrice: 1,
          refAmount: 50,
          source: 'conditional',
          orderType: 'trailing_stop',
          triggerPrice: 0.9,
          trailingPct: 0.1,
          targetWeight: 0,
        },
      ],
      factorInputs: [
        {
          factorId: 'factor',
          key: 'value',
          asOfDate: '20240102',
          observedAssets: 1,
          validAssets: 0,
          minValue: null,
          maxValue: null,
          meanValue: null,
          decisionObservations: [{ assetId: 'stock', value: null }],
        },
      ],
    };
    expect(signalWorkerMessageSchema.parse({ type: 'done', output })).toEqual({
      type: 'done',
      output,
    });
    expect(
      signalWorkerMessageSchema.safeParse({
        type: 'done',
        output: { ...output, signals: [{ ...output.signals[0], triggerPrice: 'bad' }] },
      }).success,
    ).toBe(false);
  });

  it('preserves the distinct analysis and correlation payload envelopes', () => {
    expect(
      factorAnalysisWorkerMessageSchema.parse({ type: 'done', reportId: 'report', payload: '{}' }),
    ).toEqual({ type: 'done', reportId: 'report', payload: '{}' });
    expect(
      factorAnalysisWorkerMessageSchema.safeParse({ type: 'done', payload: '{}' }).success,
    ).toBe(false);
    expect(factorCorrelationWorkerMessageSchema.parse({ type: 'done', payload: '{}' })).toEqual({
      type: 'done',
      payload: '{}',
    });
  });
});
