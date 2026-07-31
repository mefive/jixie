import type {
  BacktestMetricSummary,
  StrategyScanCell,
  StrategyScanPayload,
  StrategyScanSpec,
  StrategyParamValue,
} from '@jixie/shared';
import type { BacktestResult } from '../engine/types.js';

export const MAX_SCAN_COMBINATIONS = 25;
export const CAPACITY_DIMENSION_KEY = 'initialCash';

export function normalizeScanSpec(
  spec: StrategyScanSpec,
  declaredParams: Record<string, StrategyParamValue>,
): StrategyScanSpec {
  if (spec.view === 'capacity') {
    return normalizeCapacitySpec(spec);
  }
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

    const values: StrategyParamValue[] = [];
    for (const value of dimension.values) {
      if (typeof value !== typeof declaredParams[key]) {
        throw new Error(`strategy parameter ${key} scan values must match its declared type`);
      }
      if (
        (typeof value === 'number' && !Number.isFinite(value)) ||
        (typeof value === 'string' && (!value.trim() || value.length > 100))
      ) {
        throw new Error(`strategy parameter ${key} must use finite numbers or non-empty strings`);
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
  if (spec.view === 'sizing') {
    if (
      dimensions.length !== 1 ||
      typeof declaredParams[dimensions[0].key] !== 'string' ||
      dimensions[0].values.length > 5 ||
      spec.splitDate
    ) {
      throw new Error('sizing comparison requires one dimension, 2-5 values, and no sample split');
    }
  }

  return {
    dimensions,
    splitDate: spec.splitDate,
    view: spec.view ?? 'parameters',
  };
}

export function parameterCombinations(
  spec: StrategyScanSpec,
): Record<string, StrategyParamValue>[] {
  const [first, second] = spec.dimensions;
  if (!second) {
    return first.values.map((value) => ({ [first.key]: value }));
  }

  const combinations: Record<string, StrategyParamValue>[] = [];
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
    annVolatility: annualizedVolatility(result.nav),
    maxUnderwaterDays: maximumUnderwaterDays(result.nav),
    annSlippageDrag:
      result.initialCash > 0 && result.days > 0
        ? (result.totalSlippage / result.initialCash) * (252 / result.days)
        : 0,
  };
}

export function scanCellOverrides(
  spec: StrategyScanSpec,
  combination: Record<string, StrategyParamValue>,
): {
  initialCash?: number;
  paramOverrides: Record<string, StrategyParamValue>;
} {
  if (spec.view !== 'capacity') {
    return { paramOverrides: combination };
  }
  const initialCash = combination[CAPACITY_DIMENSION_KEY];
  if (typeof initialCash !== 'number') {
    throw new Error('capacity scan requires a numeric initialCash value');
  }
  return { initialCash, paramOverrides: {} };
}

export async function executeStrategyScan(options: {
  spec: StrategyScanSpec;
  parameters: Record<string, StrategyParamValue>;
  ranges:
    | { full: { start: string; end: string } }
    | {
        inSample: { start: string; end: string };
        outOfSample: { start: string; end: string };
      };
  run(
    params: Record<string, StrategyParamValue>,
    range: { start: string; end: string },
  ): Promise<BacktestResult>;
  onCellStart?(index: number, total: number, params: Record<string, StrategyParamValue>): void;
}): Promise<StrategyScanPayload> {
  const combinations = parameterCombinations(options.spec);
  const cells: StrategyScanCell[] = [];

  for (let index = 0; index < combinations.length; index++) {
    const params = combinations[index];
    options.onCellStart?.(index, combinations.length, params);

    if ('full' in options.ranges) {
      const result = await options.run(params, options.ranges.full);
      cells.push({
        params,
        full: metricSummary(result),
        nav: options.spec.view === 'sizing' ? rebaseNav(result.nav, result.initialCash) : undefined,
      });
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

function annualizedVolatility(nav: { value: number }[]): number {
  if (nav.length < 2) {
    return 0;
  }
  const returns: number[] = [];
  for (let i = 1; i < nav.length; i++) {
    if (nav[i - 1].value > 0) {
      returns.push(nav[i].value / nav[i - 1].value - 1);
    }
  }
  if (returns.length < 2) {
    return 0;
  }
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance * 252);
}

function maximumUnderwaterDays(nav: { value: number }[]): number {
  let peak = -Infinity;
  let current = 0;
  let longest = 0;
  for (const point of nav) {
    if (point.value >= peak) {
      peak = point.value;
      current = 0;
    } else {
      current++;
      longest = Math.max(longest, current);
    }
  }
  return longest;
}

function rebaseNav(
  nav: { date: string; value: number }[],
  initialCash: number,
): { date: string; value: number }[] {
  return nav.map((point) => ({ date: point.date, value: point.value / initialCash }));
}

function normalizeCapacitySpec(spec: StrategyScanSpec): StrategyScanSpec {
  if (spec.dimensions.length !== 1 || spec.splitDate) {
    throw new Error('capacity scan requires one dimension and no sample split');
  }
  const dimension = spec.dimensions[0];
  if (dimension.key.trim() !== CAPACITY_DIMENSION_KEY) {
    throw new Error(`capacity scan dimension must be ${CAPACITY_DIMENSION_KEY}`);
  }
  const values = [...new Set(dimension.values)];
  if (
    values.length < 3 ||
    values.length > 7 ||
    values.some(
      (value) =>
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < 10_000 ||
        value > 10_000_000_000,
    )
  ) {
    throw new Error('capacity scan requires 3-7 capital values between 10,000 and 10 billion');
  }
  return {
    dimensions: [
      {
        key: CAPACITY_DIMENSION_KEY,
        values: (values as number[]).sort((first, second) => first - second),
      },
    ],
    splitDate: undefined,
    view: 'capacity',
  };
}
