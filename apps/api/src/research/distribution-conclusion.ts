import type {
  DistributionComparisonConclusionV1,
  DistributionComparisonQuestionSpecV1,
  DistributionComparisonResultV1,
  ResearchDiagnosticV1,
} from '@jixie/shared';

export function concludeDistributionComparison(
  question: DistributionComparisonQuestionSpecV1,
  result: DistributionComparisonResultV1,
  diagnostics: ResearchDiagnosticV1[],
): DistributionComparisonConclusionV1 {
  const estimate = result.comparison.meanDifference;
  const confidenceInterval95 = result.comparison.meanDifferenceConfidenceInterval95;
  const direction = estimate > 0 ? 'group_a_higher' : estimate < 0 ? 'group_a_lower' : 'none';
  const intervalExcludesNull = confidenceInterval95.lower > 0 || confidenceInterval95.upper < 0;
  const hypothesisDirectionMatches =
    question.hypothesis.direction === 'two_sided'
      ? direction !== 'none'
      : direction === question.hypothesis.direction;
  const effectSize = standardizedEffect(result.comparison.cohensD);
  const winsorizedDirection =
    result.comparison.winsorizedMeanDifference > 0
      ? 'group_a_higher'
      : result.comparison.winsorizedMeanDifference < 0
        ? 'group_a_lower'
        : 'none';
  const robustness = {
    method: 'winsorized_mean_direction' as const,
    winsorizedMeanDifference: result.comparison.winsorizedMeanDifference,
    directionMatches: winsorizedDirection === direction,
    assessment: (winsorizedDirection === direction ? 'consistent' : 'sensitive') as
      | 'consistent'
      | 'sensitive',
  };
  const rankDirection = result.comparison.cliffsDelta > 0 ? 'group_a_higher' : 'group_a_lower';
  const rankCorroborates =
    result.comparison.mannWhitneyTwoSidedPApprox < 0.05 && rankDirection === direction;
  const hasFatalDiagnostic = diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  const rationaleCodes: string[] = [];

  let level: DistributionComparisonConclusionV1['level'];
  if (hasFatalDiagnostic) {
    level = 'indeterminate';
    rationaleCodes.push('fatal_diagnostic');
  } else if (!intervalExcludesNull) {
    level = 'does_not_support';
    rationaleCodes.push('confidence_interval_includes_null');
  } else if (!hypothesisDirectionMatches) {
    level = 'does_not_support';
    rationaleCodes.push('opposite_direction');
  } else if (
    ['moderate', 'large'].includes(effectSize.magnitude) &&
    robustness.assessment === 'consistent' &&
    rankCorroborates
  ) {
    level = 'supports';
    rationaleCodes.push(
      'interval_excludes_null',
      'direction_matches',
      'winsorized_direction_matches',
      'rank_test_corroborates',
    );
  } else {
    level = 'weak_support';
    rationaleCodes.push('interval_excludes_null', 'direction_matches');
    if (['negligible', 'small'].includes(effectSize.magnitude)) {
      rationaleCodes.push('limited_effect_size');
    }
    if (robustness.assessment === 'sensitive') {
      rationaleCodes.push('outlier_sensitive');
    }
    if (!rankCorroborates) {
      rationaleCodes.push('rank_test_does_not_corroborate');
    }
  }

  const [groupA, groupB] = result.groups;
  const interval = `[${confidenceInterval95.lower.toFixed(4)}, ${confidenceInterval95.upper.toFixed(4)}]`;
  const limitationsZh = [
    '这是单一截面的组间差异，不代表因果关系，也不能直接推出未来收益。',
    `Welch 区间描述均值差；Mann–Whitney 近似 p 值为 ${result.comparison.mannWhitneyTwoSidedPApprox.toFixed(4)}，回答的是排序位置差异。`,
  ];
  const limitationsEn = [
    'This is a between-group difference at one point in time, not causal evidence or a direct claim about future returns.',
    `The Welch interval describes a mean difference; the approximate Mann–Whitney p-value is ${result.comparison.mannWhitneyTwoSidedPApprox.toFixed(4)} and addresses a rank-location difference.`,
  ];
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity !== 'info') {
      limitationsZh.push(diagnostic.messageZh);
      limitationsEn.push(diagnostic.messageEn);
    }
  }
  const directionZh =
    direction === 'group_a_higher' ? '更高' : direction === 'group_a_lower' ? '更低' : '相同';
  const directionEn =
    direction === 'group_a_higher' ? 'higher' : direction === 'group_a_lower' ? 'lower' : 'equal';
  const levelLeadZh =
    level === 'supports'
      ? '样本支持预设差异'
      : level === 'weak_support'
        ? '样本仅弱支持预设差异'
        : level === 'does_not_support'
          ? '样本不支持预设差异'
          : '本次无法判断预设差异';
  const levelLeadEn =
    level === 'supports'
      ? 'The sample supports the prespecified difference'
      : level === 'weak_support'
        ? 'The sample provides only weak support for the prespecified difference'
        : level === 'does_not_support'
          ? 'The sample does not support the prespecified difference'
          : 'The prespecified difference is indeterminate';

  return {
    version: 1,
    level,
    direction,
    estimand: 'mean_difference',
    estimate,
    confidenceInterval95,
    intervalExcludesNull,
    hypothesisDirectionMatches,
    effectSize,
    robustness,
    rationaleCodes,
    summaryZh: `${levelLeadZh}：${groupA.label}均值比${groupB.label}${directionZh}，差值为 ${estimate.toFixed(4)}，95% 区间为 ${interval}。`,
    summaryEn: `${levelLeadEn}: the ${groupA.label} mean is ${directionEn} than the ${groupB.label} mean, with a difference of ${estimate.toFixed(4)} and a 95% interval of ${interval}.`,
    limitationsZh,
    limitationsEn,
  };
}

function standardizedEffect(value: number): DistributionComparisonConclusionV1['effectSize'] {
  const absolute = Math.abs(value);
  const magnitude =
    absolute < 0.2
      ? 'negligible'
      : absolute < 0.5
        ? 'small'
        : absolute < 0.8
          ? 'moderate'
          : 'large';
  return { metric: 'cohens_d', value, magnitude };
}
