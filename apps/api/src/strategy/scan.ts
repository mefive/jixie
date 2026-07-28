import type {
  BacktestMetricSummary,
  StrategyScanCell,
  StrategyScanPayload,
  StrategyScanSpec,
} from '@jixie/shared';
import type { BacktestResult } from '../engine/types.js';

export const MAX_SCAN_COMBINATIONS = 25;

export function normalizeScanSpec(
  spec: StrategyScanSpec,
  declaredParams: Record<string, number>,
): StrategyScanSpec {
  if (spec.dimensions.length < 1 || spec.dimensions.length > 2) {
    throw new Error('parameter scan requires one or two dimensions');
  }
  const seenKeys = new Set<string>();
  const dimensions = spec.dimensions.map((dimension) => {
    const key = dimension.key.trim();
    if (!key || !(key in declaredParams)) {
      throw new Error(`unknown strategy parameter: ${key || '(empty)'}`);
    }
    if (seenKeys.has(key)) {
      throw new Error(`duplicate strategy parameter: ${key}`);
    }
    seenKeys.add(key);

    const values: number[] = [];
    for (const value of dimension.values) {
      if (!Number.isFinite(value)) {
        throw new Error(`strategy parameter ${key} must use finite values`);
      }
      if (!values.includes(value)) {
        values.push(value);
      }
    }
    if (values.length < 2) {
      throw new Error(`strategy parameter ${key} requires at least two distinct values`);
    }
    return { key, values };
  });

  const combinationCount = dimensions.reduce(
    (product, dimension) => product * dimension.values.length,
    1,
  );
  if (combinationCount > MAX_SCAN_COMBINATIONS) {
    throw new Error(`parameter scan is limited to ${MAX_SCAN_COMBINATIONS} combinations`);
  }

  return {
    dimensions,
    splitDate: spec.splitDate,
  };
}

export function parameterCombinations(spec: StrategyScanSpec): Record<string, number>[] {
  const [first, second] = spec.dimensions;
  if (!second) {
    return first.values.map((value) => ({ [first.key]: value }));
  }

  const combinations: Record<string, number>[] = [];
  for (const firstValue of first.values) {
    for (const secondValue of second.values) {
      combinations.push({
        [first.key]: firstValue,
        [second.key]: secondValue,
      });
    }
  }
  return combinations;
}

export function metricSummary(result: BacktestResult): BacktestMetricSummary {
  return {
    start: result.start,
    end: result.end,
    days: result.days,
    finalValue: result.finalValue,
    totalReturn: result.totalReturn,
    annReturn: result.annReturn,
    sharpe: result.sharpe,
    maxDrawdown: result.maxDrawdown,
    trades: result.trades,
    benchReturn: result.benchReturn,
    excessReturn: result.excessReturn,
    informationRatio: result.informationRatio,
    calmar: result.calmar,
    winRate: result.winRate,
    profitFactor: result.profitFactor,
    turnover: result.turnover,
    totalFees: result.totalFees,
    totalSlippage: result.totalSlippage,
  };
}

export async function executeStrategyScan(options: {
  spec: StrategyScanSpec;
  parameters: Record<string, number>;
  ranges:
    | { full: { start: string; end: string } }
    | {
        inSample: { start: string; end: string };
        outOfSample: { start: string; end: string };
      };
  run(
    params: Record<string, number>,
    range: { start: string; end: string },
  ): Promise<BacktestResult>;
  onCellStart?(index: number, total: number, params: Record<string, number>): void;
}): Promise<StrategyScanPayload> {
  const combinations = parameterCombinations(options.spec);
  const cells: StrategyScanCell[] = [];

  for (let index = 0; index < combinations.length; index++) {
    const params = combinations[index];
    options.onCellStart?.(index, combinations.length, params);

    if ('full' in options.ranges) {
      const result = await options.run(params, options.ranges.full);
      cells.push({ params, full: metricSummary(result) });
      continue;
    }

    const inSample = await options.run(params, options.ranges.inSample);
    const outOfSample = await options.run(params, options.ranges.outOfSample);
    cells.push({
      params,
      inSample: metricSummary(inSample),
      outOfSample: metricSummary(outOfSample),
    });
  }

  return { parameters: options.parameters, cells };
}
