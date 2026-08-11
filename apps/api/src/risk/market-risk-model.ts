import {
  MARKET_RISK_FACTOR_KEYS_V1,
  type MarketRiskFactorKeyV1,
  type PortfolioMarketRiskAnalysisV1,
} from '@jixie/shared';
import type { MarketRiskDriverHistoryV1 } from './market-risk-drivers.js';

export const MARKET_RISK_LOOKBACK_OBSERVATIONS = 252;
export const MARKET_RISK_MINIMUM_OBSERVATIONS = 120;
export const MARKET_RISK_COVARIANCE_HALF_LIFE = 60;
export const MARKET_RISK_ANNUALIZATION = 252;

const SINGULAR_TOLERANCE = 1e-10;

export interface PortfolioReturnObservation {
  /** Availability-aligned SSE session. The underlying close return must be shifted by the same
   * next-session rule used by domestic market drivers before entering this model. */
  date: string;
  return: number;
}

export interface EstimatePortfolioMarketRiskOptions {
  asOfDate: string;
  lookbackObservations?: number;
  minimumObservations?: number;
  covarianceHalfLife?: number;
}

/** Shift close-to-close portfolio returns onto the same next-SSE availability key as domestic
 * end-of-day drivers. This changes only the join key, never the return value. */
export function alignPortfolioReturnsToNextSseSession(
  rows: Array<{ tradeDate: string; return: number }>,
  openDates: string[],
): PortfolioReturnObservation[] {
  const sessions = [...new Set(openDates)].sort();
  if (sessions.some((date) => !/^\d{8}$/.test(date))) {
    throw new Error('Portfolio-return availability calendar contains an invalid date.');
  }
  const dates = new Set<string>();
  return [...rows]
    .sort((left, right) => left.tradeDate.localeCompare(right.tradeDate))
    .map((row) => {
      if (
        !/^\d{8}$/.test(row.tradeDate) ||
        !Number.isFinite(row.return) ||
        dates.has(row.tradeDate)
      ) {
        throw new Error(`Invalid or duplicate portfolio close return ${row.tradeDate}.`);
      }
      dates.add(row.tradeDate);
      const date = sessions.find((session) => session > row.tradeDate);
      if (!date) {
        throw new Error(`No next SSE session after portfolio return date ${row.tradeDate}.`);
      }
      return { date, return: row.return };
    });
}

/** Estimate contemporaneous market exposures and EWMA factor-risk contributions. */
export function estimatePortfolioMarketRisk(
  portfolioReturns: PortfolioReturnObservation[],
  driverHistory: MarketRiskDriverHistoryV1,
  options: EstimatePortfolioMarketRiskOptions,
): PortfolioMarketRiskAnalysisV1 | null {
  const lookbackObservations = options.lookbackObservations ?? MARKET_RISK_LOOKBACK_OBSERVATIONS;
  const minimumObservations = options.minimumObservations ?? MARKET_RISK_MINIMUM_OBSERVATIONS;
  const covarianceHalfLife = options.covarianceHalfLife ?? MARKET_RISK_COVARIANCE_HALF_LIFE;
  validateOptions(options.asOfDate, lookbackObservations, minimumObservations, covarianceHalfLife);
  if (!driverHistory.lineage.pointInTimeEligible || driverHistory.lineage.futureVintageRows !== 0) {
    return null;
  }

  const returnByDate = new Map<string, number>();
  for (const observation of portfolioReturns) {
    if (!/^\d{8}$/.test(observation.date) || !Number.isFinite(observation.return)) {
      throw new Error(`Invalid availability-aligned portfolio return ${observation.date}.`);
    }
    if (returnByDate.has(observation.date)) {
      throw new Error(`Duplicate portfolio return ${observation.date}.`);
    }
    returnByDate.set(observation.date, observation.return);
  }

  const samples = driverHistory.observations
    .filter((observation) => observation.date <= options.asOfDate)
    .flatMap((observation) => {
      const portfolioReturn = returnByDate.get(observation.date);
      const values = MARKET_RISK_FACTOR_KEYS_V1.map((factor) => observation.values[factor]);
      if (
        portfolioReturn == null ||
        !Number.isFinite(portfolioReturn) ||
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

  const matrix = samples.map((sample) => sample.values);
  const response = samples.map((sample) => sample.portfolioReturn);
  const regression = standardizedLeastSquares(matrix, response);
  if (!regression) {
    return null;
  }
  const covariance = exponentiallyWeightedCovariance(matrix, covarianceHalfLife);
  const portfolioVariance = exponentiallyWeightedVariance(response, covarianceHalfLife);
  const covarianceTimesBeta = covariance.map((row) => dot(row, regression.coefficients));
  const factorVariance = dot(regression.coefficients, covarianceTimesBeta);
  const exposures = MARKET_RISK_FACTOR_KEYS_V1.map((factor, index) => {
    const varianceContribution =
      regression.coefficients[index]! * covarianceTimesBeta[index]! * MARKET_RISK_ANNUALIZATION;
    return {
      factor,
      coefficient: regression.coefficients[index]!,
      coefficientUnit: coefficientUnit(factor),
      varianceContribution,
      varianceContributionShare:
        factorVariance > SINGULAR_TOLERANCE
          ? varianceContribution / (factorVariance * MARKET_RISK_ANNUALIZATION)
          : null,
    };
  });

  return {
    version: 1,
    frequency: 'daily',
    methodology: 'rolling_multivariate_regression_ewma_covariance',
    asOfDate: samples.at(-1)!.date,
    lookbackObservations,
    minimumObservations,
    observations: samples.length,
    covarianceHalfLife,
    annualizedPortfolioVolatility:
      portfolioVariance >= 0 ? Math.sqrt(portfolioVariance * MARKET_RISK_ANNUALIZATION) : null,
    explainedVariance: regression.explainedVariance,
    exposures,
    lineage: {
      dataCutoff: options.asOfDate,
      pointInTimeEligible: true,
      futureVintageRows: 0,
      series: MARKET_RISK_FACTOR_KEYS_V1.map((factor) => {
        const availableThrough = driverHistory.observations
          .filter(
            (observation) =>
              observation.date <= options.asOfDate && observation.values[factor] != null,
          )
          .map((observation) => observation.date)
          .sort()
          .at(-1);
        if (!availableThrough) {
          throw new Error(`Market-risk report has no lineage date for ${factor}.`);
        }
        return { seriesKey: factor, availableThrough, revisionPolicy: 'not_revised' };
      }),
    },
  };
}

function standardizedLeastSquares(
  matrix: number[][],
  response: number[],
): { coefficients: number[]; explainedVariance: number } | null {
  const observations = matrix.length;
  const factors = matrix[0]?.length ?? 0;
  if (
    observations !== response.length ||
    factors !== MARKET_RISK_FACTOR_KEYS_V1.length ||
    matrix.some((row) => row.length !== factors)
  ) {
    throw new Error('Market-risk regression matrix has inconsistent dimensions.');
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
  const standardized = matrix.map((row) =>
    row.map((value, column) => (value - means[column]!) / scales[column]!),
  );
  const responseMean = mean(response);
  const centeredResponse = response.map((value) => value - responseMean);
  const standardizedCoefficients = solveLeastSquaresQr(standardized, centeredResponse);
  if (!standardizedCoefficients) {
    return null;
  }
  const coefficients = standardizedCoefficients.map(
    (coefficient, index) => coefficient / scales[index]!,
  );
  const fittedCentered = matrix.map((row) =>
    row.reduce((sum, value, index) => sum + coefficients[index]! * (value - means[index]!), 0),
  );
  const totalSumOfSquares = centeredResponse.reduce((sum, value) => sum + value * value, 0);
  const residualSumOfSquares = centeredResponse.reduce((sum, value, index) => {
    const residual = value - fittedCentered[index]!;
    return sum + residual * residual;
  }, 0);
  return {
    coefficients,
    explainedVariance:
      totalSumOfSquares > SINGULAR_TOLERANCE
        ? Math.max(0, Math.min(1, 1 - residualSumOfSquares / totalSumOfSquares))
        : 0,
  };
}

/** Modified Gram-Schmidt QR is sufficient for the fixed 9-column standardized design. */
function solveLeastSquaresQr(matrix: number[][], response: number[]): number[] | null {
  const observations = matrix.length;
  const factors = matrix[0]?.length ?? 0;
  const qColumns: number[][] = [];
  const upper = Array.from({ length: factors }, () => Array(factors).fill(0) as number[]);
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

function exponentiallyWeightedCovariance(matrix: number[][], halfLife: number): number[][] {
  const weights = exponentialWeights(matrix.length, halfLife);
  const factors = matrix[0]!.length;
  const means = Array.from({ length: factors }, (_, column) =>
    matrix.reduce((sum, row, index) => sum + weights[index]! * row[column]!, 0),
  );
  return Array.from({ length: factors }, (_, left) =>
    Array.from({ length: factors }, (_, right) =>
      matrix.reduce(
        (sum, row, index) =>
          sum + weights[index]! * (row[left]! - means[left]!) * (row[right]! - means[right]!),
        0,
      ),
    ),
  );
}

function exponentiallyWeightedVariance(values: number[], halfLife: number): number {
  const weights = exponentialWeights(values.length, halfLife);
  const average = values.reduce((sum, value, index) => sum + weights[index]! * value, 0);
  return values.reduce((sum, value, index) => sum + weights[index]! * (value - average) ** 2, 0);
}

function exponentialWeights(length: number, halfLife: number): number[] {
  const raw = Array.from({ length }, (_, index) => 0.5 ** ((length - 1 - index) / halfLife));
  const total = raw.reduce((sum, value) => sum + value, 0);
  return raw.map((value) => value / total);
}

function coefficientUnit(
  factor: MarketRiskFactorKeyV1,
): 'return_per_return' | 'return_per_basis_point' {
  return ['cgb_level', 'cgb_slope', 'cgb_curvature', 'credit_spread', 'us_real_yield'].includes(
    factor,
  )
    ? 'return_per_basis_point'
    : 'return_per_return';
}

function validateOptions(
  asOfDate: string,
  lookbackObservations: number,
  minimumObservations: number,
  covarianceHalfLife: number,
): void {
  if (!/^\d{8}$/.test(asOfDate)) {
    throw new Error('Market-risk asOfDate must be YYYYMMDD.');
  }
  if (
    !Number.isInteger(lookbackObservations) ||
    !Number.isInteger(minimumObservations) ||
    lookbackObservations < MARKET_RISK_FACTOR_KEYS_V1.length + 2 ||
    minimumObservations < MARKET_RISK_FACTOR_KEYS_V1.length + 2 ||
    minimumObservations > lookbackObservations ||
    !Number.isFinite(covarianceHalfLife) ||
    covarianceHalfLife <= 0
  ) {
    throw new Error('Invalid market-risk lookback, minimum, or covariance half-life.');
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

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function dot(left: number[], right: number[]): number {
  if (left.length !== right.length) {
    throw new Error('Market-risk dot product dimension mismatch.');
  }
  return left.reduce((sum, value, index) => sum + value * right[index]!, 0);
}
