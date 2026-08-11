import { MACRO_RISK_AXIS_KEYS_V1, type PortfolioMacroRiskAnalysisV1 } from '@jixie/shared';
import { MACRO_RISK_MARKET_SERIES_KEYS, type MacroRiskAxisHistoryV1 } from './macro-risk-axes.js';

export const MACRO_RISK_LOOKBACK_OBSERVATIONS = 60;
export const MACRO_RISK_MINIMUM_OBSERVATIONS = 36;

const SINGULAR_TOLERANCE = 1e-10;

export interface PortfolioMonthlyReturnObservation {
  date: string;
  return: number;
}

export interface EstimatePortfolioMacroRiskOptions {
  asOfDate: string;
  lookbackObservations?: number;
  minimumObservations?: number;
  neweyWestLag?: number;
}

/** Compounds daily portfolio returns into calendar months keyed by the last observed SSE session. */
export function aggregatePortfolioMonthlyReturns(
  rows: Array<{ date: string; return: number }>,
): PortfolioMonthlyReturnObservation[] {
  const dates = new Set<string>();
  const byMonth = new Map<string, PortfolioMonthlyReturnObservation>();
  for (const row of [...rows].sort((left, right) => left.date.localeCompare(right.date))) {
    if (
      !/^\d{8}$/.test(row.date) ||
      !Number.isFinite(row.return) ||
      row.return <= -1 ||
      dates.has(row.date)
    ) {
      throw new Error(`Invalid or duplicate portfolio daily return ${row.date}.`);
    }
    dates.add(row.date);
    const month = row.date.slice(0, 6);
    const current = byMonth.get(month);
    byMonth.set(month, {
      date: row.date,
      return: (1 + (current?.return ?? 0)) * (1 + row.return) - 1,
    });
  }
  return [...byMonth.values()];
}

/** Estimates descriptive monthly portfolio sensitivities with Newey-West robust inference. */
export function estimatePortfolioMacroRisk(
  portfolioReturns: PortfolioMonthlyReturnObservation[],
  axisHistory: MacroRiskAxisHistoryV1,
  options: EstimatePortfolioMacroRiskOptions,
): PortfolioMacroRiskAnalysisV1 | null {
  const lookbackObservations = options.lookbackObservations ?? MACRO_RISK_LOOKBACK_OBSERVATIONS;
  const minimumObservations = options.minimumObservations ?? MACRO_RISK_MINIMUM_OBSERVATIONS;
  validateOptions(
    options.asOfDate,
    lookbackObservations,
    minimumObservations,
    options.neweyWestLag,
  );
  const returnByDate = new Map<string, number>();
  for (const observation of portfolioReturns) {
    if (
      !/^\d{8}$/.test(observation.date) ||
      !Number.isFinite(observation.return) ||
      returnByDate.has(observation.date)
    ) {
      throw new Error(`Invalid or duplicate portfolio monthly return ${observation.date}.`);
    }
    returnByDate.set(observation.date, observation.return);
  }
  const samples = axisHistory.observations
    .filter((observation) => observation.date <= options.asOfDate)
    .flatMap((observation) => {
      const portfolioReturn = returnByDate.get(observation.date);
      const values = MACRO_RISK_AXIS_KEYS_V1.map((axis) => observation.values[axis]);
      if (
        portfolioReturn == null ||
        !values.every((value): value is number => value != null && Number.isFinite(value))
      ) {
        return [];
      }
      return [{ date: observation.date, portfolioReturn, values }];
    })
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-lookbackObservations);
  if (samples.length < minimumObservations) {
    return null;
  }
  const neweyWestLag = options.neweyWestLag ?? Math.floor(4 * (samples.length / 100) ** (2 / 9));
  if (neweyWestLag >= samples.length) {
    throw new Error('Macro-risk Newey-West lag must be smaller than the observation count.');
  }
  const regression = neweyWestRegression(
    samples.map((sample) => sample.values),
    samples.map((sample) => sample.portfolioReturn),
    neweyWestLag,
  );
  if (!regression) {
    return null;
  }
  const reportAsOf = samples.at(-1)!.date;
  const latestState = axisHistory.states
    .filter((state) => state.date <= reportAsOf)
    .sort((left, right) => left.date.localeCompare(right.date))
    .at(-1);
  if (!latestState) {
    return null;
  }
  const lineageSeries = Object.entries(latestState.seriesAvailableThrough).map(
    ([seriesKey, availableThrough]) => ({
      seriesKey,
      availableThrough,
      revisionPolicy: MACRO_RISK_MARKET_SERIES_KEYS.includes(
        seriesKey as (typeof MACRO_RISK_MARKET_SERIES_KEYS)[number],
      )
        ? ('not_revised' as const)
        : axisHistory.revisionPolicy,
    }),
  );

  return {
    version: 1,
    frequency: 'monthly',
    methodology: 'monthly_multivariate_regression_newey_west',
    asOfDate: reportAsOf,
    lookbackObservations,
    minimumObservations,
    observations: samples.length,
    neweyWestLag,
    pointInTimeEligible: latestState.pointInTimeEligible,
    sensitivities: MACRO_RISK_AXIS_KEYS_V1.map((axis, index) => ({
      axis,
      coefficient: regression.coefficients[index]!,
      neweyWestTStat: regression.tStatistics[index]!,
      observations: samples.length,
    })),
    lineage: {
      dataCutoff: options.asOfDate,
      pointInTimeEligible: latestState.pointInTimeEligible,
      futureVintageRows: latestState.futureVintageRows,
      series: lineageSeries,
    },
  };
}

function neweyWestRegression(
  matrix: number[][],
  response: number[],
  lag: number,
): { coefficients: number[]; tStatistics: number[] } | null {
  const observations = matrix.length;
  const factors = matrix[0]?.length ?? 0;
  if (
    observations !== response.length ||
    factors !== MACRO_RISK_AXIS_KEYS_V1.length ||
    matrix.some((row) => row.length !== factors)
  ) {
    throw new Error('Macro-risk regression matrix has inconsistent dimensions.');
  }
  const means = Array.from({ length: factors }, (_, column) =>
    mean(matrix.map((row) => row[column]!)),
  );
  const scales = Array.from({ length: factors }, (_, column) =>
    sampleStandardDeviation(matrix.map((row) => row[column]!)),
  );
  if (scales.some((scale) => !Number.isFinite(scale) || scale <= SINGULAR_TOLERANCE)) {
    return null;
  }
  const design = matrix.map((row) => [
    1,
    ...row.map((value, column) => (value - means[column]!) / scales[column]!),
  ]);
  const coefficients = solveLeastSquaresQr(design, response);
  if (!coefficients) {
    return null;
  }
  const residuals = design.map((row, index) => response[index]! - dot(row, coefficients));
  const inverseMoment = invertMatrix(crossProduct(design));
  if (!inverseMoment) {
    return null;
  }
  const meat = neweyWestMeat(design, residuals, lag);
  const covariance = multiplyMatrices(multiplyMatrices(inverseMoment, meat), inverseMoment);
  const finiteSampleScale = observations / (observations - design[0]!.length);
  const factorStandardErrors = covariance
    .slice(1)
    .map((row, index) => Math.sqrt(Math.max(0, row[index + 1]! * finiteSampleScale)));
  if (
    factorStandardErrors.some(
      (standardError) => !Number.isFinite(standardError) || standardError <= SINGULAR_TOLERANCE,
    )
  ) {
    return null;
  }
  const standardizedCoefficients = coefficients.slice(1);
  return {
    coefficients: standardizedCoefficients.map(
      (coefficient, index) => coefficient / scales[index]!,
    ),
    tStatistics: standardizedCoefficients.map(
      (coefficient, index) => coefficient / factorStandardErrors[index]!,
    ),
  };
}

function neweyWestMeat(design: number[][], residuals: number[], lag: number): number[][] {
  const dimensions = design[0]!.length;
  const meat = zeroMatrix(dimensions);
  for (let index = 0; index < design.length; index++) {
    addOuterProduct(meat, design[index]!, design[index]!, residuals[index]! ** 2);
  }
  for (let offset = 1; offset <= lag; offset++) {
    const weight = 1 - offset / (lag + 1);
    for (let index = offset; index < design.length; index++) {
      const scale = weight * residuals[index]! * residuals[index - offset]!;
      addOuterProduct(meat, design[index]!, design[index - offset]!, scale);
      addOuterProduct(meat, design[index - offset]!, design[index]!, scale);
    }
  }
  return meat;
}

function solveLeastSquaresQr(matrix: number[][], response: number[]): number[] | null {
  const observations = matrix.length;
  const factors = matrix[0]?.length ?? 0;
  const qColumns: number[][] = [];
  const upper = zeroMatrix(factors);
  for (let column = 0; column < factors; column++) {
    const vector = Array.from({ length: observations }, (_, row) => matrix[row]![column]!);
    for (let previous = 0; previous < column; previous++) {
      const projection = dot(qColumns[previous]!, vector);
      upper[previous]![column] = projection;
      for (let row = 0; row < observations; row++) {
        vector[row] -= projection * qColumns[previous]![row]!;
      }
    }
    const norm = Math.sqrt(dot(vector, vector));
    if (!Number.isFinite(norm) || norm <= SINGULAR_TOLERANCE * Math.sqrt(observations)) {
      return null;
    }
    upper[column]![column] = norm;
    qColumns.push(vector.map((value) => value / norm));
  }
  const transformedResponse = qColumns.map((column) => dot(column, response));
  const solution = Array(factors).fill(0) as number[];
  for (let row = factors - 1; row >= 0; row--) {
    let value = transformedResponse[row]!;
    for (let column = row + 1; column < factors; column++) {
      value -= upper[row]![column]! * solution[column]!;
    }
    solution[row] = value / upper[row]![row]!;
  }
  return solution;
}

function invertMatrix(matrix: number[][]): number[][] | null {
  const dimensions = matrix.length;
  const augmented = matrix.map((row, index) => [
    ...row,
    ...Array.from({ length: dimensions }, (_, column) => (column === index ? 1 : 0)),
  ]);
  for (let column = 0; column < dimensions; column++) {
    let pivot = column;
    for (let row = column + 1; row < dimensions; row++) {
      if (Math.abs(augmented[row]![column]!) > Math.abs(augmented[pivot]![column]!)) {
        pivot = row;
      }
    }
    if (Math.abs(augmented[pivot]![column]!) <= SINGULAR_TOLERANCE) {
      return null;
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot]!, augmented[column]!];
    const pivotValue = augmented[column]![column]!;
    augmented[column] = augmented[column]!.map((value) => value / pivotValue);
    for (let row = 0; row < dimensions; row++) {
      if (row === column) {
        continue;
      }
      const scale = augmented[row]![column]!;
      augmented[row] = augmented[row]!.map(
        (value, index) => value - scale * augmented[column]![index]!,
      );
    }
  }
  return augmented.map((row) => row.slice(dimensions));
}

function crossProduct(matrix: number[][]): number[][] {
  const dimensions = matrix[0]!.length;
  return Array.from({ length: dimensions }, (_, left) =>
    Array.from({ length: dimensions }, (_, right) =>
      matrix.reduce((sum, row) => sum + row[left]! * row[right]!, 0),
    ),
  );
}

function multiplyMatrices(left: number[][], right: number[][]): number[][] {
  return left.map((row) =>
    right[0]!.map((_, column) =>
      row.reduce((sum, value, index) => sum + value * right[index]![column]!, 0),
    ),
  );
}

function addOuterProduct(target: number[][], left: number[], right: number[], scale: number): void {
  for (let row = 0; row < left.length; row++) {
    for (let column = 0; column < right.length; column++) {
      target[row]![column] += scale * left[row]! * right[column]!;
    }
  }
}

function zeroMatrix(dimensions: number): number[][] {
  return Array.from({ length: dimensions }, () => Array(dimensions).fill(0) as number[]);
}

function validateOptions(
  asOfDate: string,
  lookbackObservations: number,
  minimumObservations: number,
  neweyWestLag: number | undefined,
): void {
  if (!/^\d{8}$/.test(asOfDate)) {
    throw new Error('Macro-risk asOfDate must be YYYYMMDD.');
  }
  if (
    !Number.isInteger(lookbackObservations) ||
    !Number.isInteger(minimumObservations) ||
    lookbackObservations < MACRO_RISK_AXIS_KEYS_V1.length + 2 ||
    minimumObservations < MACRO_RISK_AXIS_KEYS_V1.length + 2 ||
    minimumObservations > lookbackObservations ||
    (neweyWestLag != null && (!Number.isInteger(neweyWestLag) || neweyWestLag < 0))
  ) {
    throw new Error('Invalid macro-risk lookback, minimum, or Newey-West lag.');
  }
}

function sampleStandardDeviation(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const average = mean(values);
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1),
  );
}

function dot(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + value * right[index]!, 0);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
