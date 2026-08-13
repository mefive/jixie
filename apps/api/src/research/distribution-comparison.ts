import type {
  DistributionComparisonProtocolSpecV1,
  DistributionComparisonResultV1,
  ResearchDiagnosticV1,
  ResearchDistributionGroupV1,
  ResearchDistributionObservationV1,
  ResearchDistributionSummaryV1,
  ResearchUniverseMeasureDefinitionV1,
} from '@jixie/shared';

const NORMAL_95_PERCENT_CRITICAL_VALUE = 1.959963984540054;

export interface DistributionComparisonEvaluation {
  result: DistributionComparisonResultV1;
  diagnostics: ResearchDiagnosticV1[];
}

export function evaluateDistributionComparison(
  protocol: DistributionComparisonProtocolSpecV1,
  measure: ResearchUniverseMeasureDefinitionV1,
  groupA: { inputId: string; label: string; observations: ResearchDistributionObservationV1[] },
  groupB: { inputId: string; label: string; observations: ResearchDistributionObservationV1[] },
  minimumObservations: number,
): DistributionComparisonEvaluation {
  if (
    groupA.observations.length < minimumObservations ||
    groupB.observations.length < minimumObservations
  ) {
    throw new Error(
      `distribution_comparison requires at least ${minimumObservations} valid observations in each group; received ${groupA.observations.length} and ${groupB.observations.length}`,
    );
  }

  const valuesA = groupA.observations.map((observation) => observation.value);
  const valuesB = groupB.observations.map((observation) => observation.value);
  const summaryA = summarizeDistribution(valuesA, protocol.sensitivity.tailFraction);
  const summaryB = summarizeDistribution(valuesB, protocol.sensitivity.tailFraction);
  const meanDifference = summaryA.mean - summaryB.mean;
  const varianceA = summaryA.standardDeviation ** 2;
  const varianceB = summaryB.standardDeviation ** 2;
  const varianceTermA = varianceA / summaryA.count;
  const varianceTermB = varianceB / summaryB.count;
  const meanDifferenceStandardError = Math.sqrt(varianceTermA + varianceTermB);
  if (!Number.isFinite(meanDifferenceStandardError) || meanDifferenceStandardError === 0) {
    throw new Error('distribution_comparison requires non-zero within-group variation');
  }
  const welchDegreesOfFreedom =
    (varianceTermA + varianceTermB) ** 2 /
    (varianceTermA ** 2 / (summaryA.count - 1) + varianceTermB ** 2 / (summaryB.count - 1));
  const criticalValue = studentTCritical95(welchDegreesOfFreedom);
  const radius = criticalValue * meanDifferenceStandardError;
  const pooledVariance =
    ((summaryA.count - 1) * varianceA + (summaryB.count - 1) * varianceB) /
    (summaryA.count + summaryB.count - 2);
  const ranks = mannWhitney(valuesA, valuesB);
  const winsorizedMeanDifference = summaryA.winsorizedMean - summaryB.winsorizedMean;
  const groups: [ResearchDistributionGroupV1, ResearchDistributionGroupV1] = [
    { ...groupA, summary: summaryA },
    { ...groupB, summary: summaryB },
  ];
  const diagnostics = distributionDiagnostics(groups, meanDifference, winsorizedMeanDifference);

  return {
    result: {
      kind: 'distribution_comparison',
      version: 1,
      observations: summaryA.count + summaryB.count,
      measure,
      groups,
      comparison: {
        meanDifference,
        meanDifferenceStandardError,
        meanDifferenceConfidenceInterval95: {
          lower: meanDifference - radius,
          upper: meanDifference + radius,
        },
        welchTStatistic: meanDifference / meanDifferenceStandardError,
        welchDegreesOfFreedom,
        mannWhitneyU: ranks.u,
        mannWhitneyZ: ranks.z,
        mannWhitneyTwoSidedPApprox: ranks.p,
        cohensD: meanDifference / Math.sqrt(pooledVariance),
        cliffsDelta: (2 * ranks.u) / (summaryA.count * summaryB.count) - 1,
        winsorizedMeanDifference,
      },
    },
    diagnostics,
  };
}

export function summarizeDistribution(
  values: number[],
  tailFraction: number,
): ResearchDistributionSummaryV1 {
  const sorted = [...values].sort((left, right) => left - right);
  const mean = average(sorted);
  const variance =
    sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, sorted.length - 1);
  const lower = quantile(sorted, tailFraction);
  const upper = quantile(sorted, 1 - tailFraction);
  return {
    count: sorted.length,
    mean,
    standardDeviation: Math.sqrt(variance),
    minimum: sorted[0]!,
    firstQuartile: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    thirdQuartile: quantile(sorted, 0.75),
    maximum: sorted.at(-1)!,
    winsorizedMean: average(sorted.map((value) => Math.max(lower, Math.min(upper, value)))),
  };
}

function quantile(sorted: number[], probability: number): number {
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const weight = position - lowerIndex;
  return sorted[lowerIndex]! * (1 - weight) + sorted[upperIndex]! * weight;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function studentTCritical95(degreesOfFreedom: number): number {
  const z = NORMAL_95_PERCENT_CRITICAL_VALUE;
  const inverse = 1 / degreesOfFreedom;
  return (
    z +
    ((z ** 3 + z) * inverse) / 4 +
    ((5 * z ** 5 + 16 * z ** 3 + 3 * z) * inverse ** 2) / 96 +
    ((3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) * inverse ** 3) / 384
  );
}

function mannWhitney(valuesA: number[], valuesB: number[]): { u: number; z: number; p: number } {
  const combined = [
    ...valuesA.map((value) => ({ value, group: 'A' as const })),
    ...valuesB.map((value) => ({ value, group: 'B' as const })),
  ].sort((left, right) => left.value - right.value);
  let rankSumA = 0;
  let tieAdjustment = 0;
  let index = 0;
  while (index < combined.length) {
    let end = index + 1;
    while (end < combined.length && combined[end]!.value === combined[index]!.value) {
      end += 1;
    }
    const averageRank = (index + 1 + end) / 2;
    for (let cursor = index; cursor < end; cursor += 1) {
      if (combined[cursor]!.group === 'A') {
        rankSumA += averageRank;
      }
    }
    const tieSize = end - index;
    tieAdjustment += tieSize ** 3 - tieSize;
    index = end;
  }
  const nA = valuesA.length;
  const nB = valuesB.length;
  const total = nA + nB;
  const u = rankSumA - (nA * (nA + 1)) / 2;
  const expected = (nA * nB) / 2;
  const variance = (nA * nB * (total + 1 - tieAdjustment / (total * (total - 1)))) / 12;
  const centered = u - expected;
  const continuity = centered === 0 ? 0 : Math.sign(centered) * 0.5;
  const z = (centered - continuity) / Math.sqrt(variance);
  const p = Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));
  return { u, z, p };
}

function normalCdf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const absolute = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * absolute);
  const polynomial =
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const erf = sign * (1 - polynomial * Math.exp(-absolute * absolute));
  return 0.5 * (1 + erf);
}

function distributionDiagnostics(
  groups: [ResearchDistributionGroupV1, ResearchDistributionGroupV1],
  meanDifference: number,
  winsorizedMeanDifference: number,
): ResearchDiagnosticV1[] {
  const diagnostics: ResearchDiagnosticV1[] = [];
  const [groupA, groupB] = groups;
  const balance =
    Math.min(groupA.summary.count, groupB.summary.count) /
    Math.max(groupA.summary.count, groupB.summary.count);
  if (balance < 0.25) {
    diagnostics.push({
      code: 'distribution_group_imbalance',
      severity: 'warning',
      messageZh: `两组样本量相差较大（${groupA.summary.count} 对 ${groupB.summary.count}），均值差主要由较小组的不确定性限制。`,
      messageEn: `Group sizes are highly imbalanced (${groupA.summary.count} versus ${groupB.summary.count}); uncertainty is constrained by the smaller group.`,
    });
  }
  if (direction(meanDifference) !== direction(winsorizedMeanDifference)) {
    diagnostics.push({
      code: 'distribution_outlier_direction_sensitive',
      severity: 'warning',
      messageZh: '缩尾后均值差方向发生改变，原始均值结论对极端值敏感。',
      messageEn:
        'The mean-difference direction changes after winsorization; the raw-mean result is sensitive to extremes.',
    });
  }
  return diagnostics;
}

function direction(value: number): -1 | 0 | 1 {
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}
