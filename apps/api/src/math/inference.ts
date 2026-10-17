import type { FactorNeweyWestEstimateV1 } from '@jixie/shared';

const SINGULAR_TOLERANCE = 1e-10;
const NORMAL_95_PERCENT_CRITICAL_VALUE = 1.959963984540054;

/**
 * 封装回归系数、标准误及统计推断结果，供研究报告展示。
 * Collect regression coefficients, standard errors and inferential statistics for research reports.
 */
export interface RegressionInference {
  coefficients: number[];
  standardErrors: number[];
  tStatistics: number[];
}

/**
 * 按常用带宽规则选择 Newey–West 滞后阶数，并限制在可用观测范围。
 * Common automatic bandwidth rule, capped to the available ordered observations.
 */
export function automaticNeweyWestLag(observations: number, minimumLag = 0): number {
  const automatic = Math.floor(4 * (Math.max(observations, 1) / 100) ** (2 / 9));
  return Math.min(Math.max(automatic, minimumLag), Math.max(0, observations - 1));
}

/**
 * 对按时间排序的序列均值进行 Newey–West/HAC 稳健推断。
 * Newey–West/HAC inference for the mean of an ordered period series.
 */
export function neweyWestMeanInference(
  values: number[],
  requestedLag: number,
): FactorNeweyWestEstimateV1 | null {
  if (values.length < 2 || values.some((value) => !Number.isFinite(value))) {
    return null;
  }
  const observations = values.length;
  const estimate = values.reduce((sum, value) => sum + value, 0) / observations;
  const residuals = values.map((value) => value - estimate);
  const lag = Math.min(Math.max(0, requestedLag), observations - 1);
  let longRunVariance =
    residuals.reduce((sum, residual) => sum + residual * residual, 0) / observations;
  for (let distance = 1; distance <= lag; distance++) {
    const weight = 1 - distance / (lag + 1);
    let covariance = 0;
    for (let index = distance; index < observations; index++) {
      covariance += residuals[index]! * residuals[index - distance]!;
    }
    longRunVariance += 2 * weight * (covariance / observations);
  }
  const standardError = Math.sqrt(Math.max(0, longRunVariance) / observations);
  const radius = NORMAL_95_PERCENT_CRITICAL_VALUE * standardError;
  return {
    estimate,
    standardError,
    tStatistic: standardError > SINGULAR_TOLERANCE ? estimate / standardError : 0,
    confidenceInterval: { lower: estimate - radius, upper: estimate + radius },
    observations,
    lag,
  };
}

/**
 * 对单个截面计算总体 z-score；无有效离散度时返回 null。
 * Population z-scores for one cross-section. Null means the exposure has no usable dispersion.
 */
export function populationZScores(values: number[]): number[] | null {
  if (values.length < 2 || values.some((value) => !Number.isFinite(value))) {
    return null;
  }
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  const scale = Math.sqrt(variance);
  if (!Number.isFinite(scale) || scale <= SINGULAR_TOLERANCE) {
    return null;
  }
  return values.map((value) => (value - average) / scale);
}

/**
 * 对调用方提供的设计矩阵求 OLS 系数；需要截距时由调用方显式加入常数列。
 * OLS coefficients for a caller-supplied design matrix. Include an intercept column when required.
 */
export function leastSquaresCoefficients(design: number[][], response: number[]): number[] | null {
  validateRegressionDimensions(design, response);
  const observations = design.length;
  const dimensions = design[0]?.length ?? 0;
  if (observations < dimensions || dimensions === 0) {
    return null;
  }
  const qColumns: number[][] = [];
  const upper = zeroMatrix(dimensions);
  for (let column = 0; column < dimensions; column++) {
    const vector = Array.from({ length: observations }, (_, row) => design[row]![column]!);
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
  const solution = Array(dimensions).fill(0) as number[];
  for (let row = dimensions - 1; row >= 0; row--) {
    let value = transformedResponse[row]!;
    for (let column = row + 1; column < dimensions; column++) {
      value -= upper[row]![column]! * solution[column]!;
    }
    solution[row] = value / upper[row]![row]!;
  }
  return solution;
}

/**
 * 对按时间排序的 OLS 回归计算 Newey–West 三明治协方差与稳健推断。
 * Newey–West sandwich inference for a time-ordered OLS regression.
 */
export function neweyWestRegression(
  design: number[][],
  response: number[],
  requestedLag: number,
): RegressionInference | null {
  validateRegressionDimensions(design, response);
  const coefficients = leastSquaresCoefficients(design, response);
  if (!coefficients) {
    return null;
  }
  const observations = design.length;
  const dimensions = design[0]!.length;
  const residuals = design.map((row, index) => response[index]! - dot(row, coefficients));
  const inverseMoment = invertMatrix(crossProduct(design));
  if (!inverseMoment) {
    return null;
  }
  const lag = Math.min(Math.max(0, requestedLag), observations - 1);
  const meat = zeroMatrix(dimensions);
  for (let index = 0; index < observations; index++) {
    addOuterProduct(meat, design[index]!, design[index]!, residuals[index]! ** 2);
  }
  for (let distance = 1; distance <= lag; distance++) {
    const weight = 1 - distance / (lag + 1);
    for (let index = distance; index < observations; index++) {
      const scale = weight * residuals[index]! * residuals[index - distance]!;
      addOuterProduct(meat, design[index]!, design[index - distance]!, scale);
      addOuterProduct(meat, design[index - distance]!, design[index]!, scale);
    }
  }
  const covariance = multiplyMatrices(multiplyMatrices(inverseMoment, meat), inverseMoment);
  const standardErrors = coefficients.map((_, index) =>
    Math.sqrt(Math.max(0, covariance[index]![index]!)),
  );
  if (standardErrors.some((value) => !Number.isFinite(value))) {
    return null;
  }
  return {
    coefficients,
    standardErrors,
    tStatistics: coefficients.map((coefficient, index) =>
      standardErrors[index]! > SINGULAR_TOLERANCE ? coefficient / standardErrors[index]! : 0,
    ),
  };
}

/**
 * 检查回归矩阵、响应向量和样本维度，避免在不匹配输入上计算。
 * Validate regression matrix, response and sample dimensions before numerical operations.
 */
function validateRegressionDimensions(design: number[][], response: number[]): void {
  const dimensions = design[0]?.length ?? 0;
  if (
    design.length !== response.length ||
    design.length === 0 ||
    dimensions === 0 ||
    design.some(
      (row) => row.length !== dimensions || row.some((value) => !Number.isFinite(value)),
    ) ||
    response.some((value) => !Number.isFinite(value))
  ) {
    throw new Error('Regression matrix has inconsistent dimensions or non-finite values.');
  }
}

/**
 * 通过消元求方阵逆，检测不可逆或不稳定枢轴供回归计算使用。
 * Invert a square matrix by elimination, detecting unusable pivots for regression calculations.
 */
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

/**
 * 计算设计矩阵交叉积，供 OLS 与稳健协方差公式使用。
 * Compute the design cross-product used by OLS and robust covariance calculations.
 */
function crossProduct(matrix: number[][]): number[][] {
  const dimensions = matrix[0]!.length;
  return Array.from({ length: dimensions }, (_, left) =>
    Array.from({ length: dimensions }, (_, right) =>
      matrix.reduce((sum, row) => sum + row[left]! * row[right]!, 0),
    ),
  );
}

/**
 * 执行矩阵乘法，供回归系数与协方差运算复用。
 * Multiply matrices for regression coefficient and covariance calculations.
 */
function multiplyMatrices(left: number[][], right: number[][]): number[][] {
  return left.map((row) =>
    right[0]!.map((_, column) =>
      row.reduce((sum, value, index) => sum + value * right[index]![column]!, 0),
    ),
  );
}

/**
 * 按权重将向量外积累加到矩阵，供 HAC 协方差核累积。
 * Accumulate a weighted vector outer product into the HAC covariance kernel.
 */
function addOuterProduct(target: number[][], left: number[], right: number[], scale: number): void {
  for (let row = 0; row < left.length; row++) {
    for (let column = 0; column < right.length; column++) {
      target[row]![column] += scale * left[row]! * right[column]!;
    }
  }
}

/**
 * 按指定维度构造零矩阵，供数值算法累加使用。
 * Allocate a zero matrix for numerical accumulation.
 */
function zeroMatrix(dimensions: number): number[][] {
  return Array.from({ length: dimensions }, () => Array(dimensions).fill(0) as number[]);
}

/**
 * 计算向量内积，供回归预测和矩阵运算使用。
 * Compute a vector dot product for regression prediction and matrix operations.
 */
function dot(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + value * right[index]!, 0);
}
