import type {
  ResearchConclusionV1,
  ResearchDiagnosticV1,
  TimeSeriesRelationshipQuestionSpecV1,
  TimeSeriesRelationshipResultV1,
} from '@jixie/shared';

export function concludeTimeSeriesRelationship(
  question: TimeSeriesRelationshipQuestionSpecV1,
  result: TimeSeriesRelationshipResultV1,
  diagnostics: ResearchDiagnosticV1[],
): ResearchConclusionV1 {
  const estimate = result.regression.slope;
  const confidenceInterval95 = result.regression.slopeConfidenceInterval95;
  const direction = estimate > 0 ? 'positive' : estimate < 0 ? 'negative' : 'none';
  const intervalExcludesNull =
    confidenceInterval95.lower > question.hypothesis.nullValue ||
    confidenceInterval95.upper < question.hypothesis.nullValue;
  const hypothesisDirectionMatches = directionMatches(direction, question.hypothesis.direction);
  const effectSize = relationshipEffectSize(result);
  const stability = rollingStability(result, direction);
  const hasFatalDiagnostic = diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  const rationaleCodes: string[] = [];

  let level: ResearchConclusionV1['level'];
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
    stability.assessment === 'stable' &&
    ['moderate', 'large'].includes(effectSize.magnitude)
  ) {
    level = 'supports';
    rationaleCodes.push('interval_excludes_null', 'direction_matches', 'stable_rolling_effect');
  } else {
    level = 'weak_support';
    rationaleCodes.push('interval_excludes_null', 'direction_matches');
    if (['negligible', 'small'].includes(effectSize.magnitude)) {
      rationaleCodes.push('limited_effect_size');
    }
    if (stability.assessment === 'unstable') {
      rationaleCodes.push('unstable_rolling_effect');
    } else if (stability.assessment === 'not_assessed') {
      rationaleCodes.push('stability_not_assessed');
    }
  }

  const limitations = conclusionLimitations(diagnostics, stability.assessment);
  const summaries = conclusionSummaries({
    level,
    direction,
    estimate,
    confidenceInterval95,
    effectMagnitude: effectSize.magnitude,
    stability,
  });

  return {
    version: 1,
    level,
    direction,
    estimand: 'regression_slope',
    estimate,
    confidenceInterval95,
    intervalExcludesNull,
    hypothesisDirectionMatches,
    effectSize,
    stability,
    rationaleCodes,
    ...summaries,
    ...limitations,
  };
}

function directionMatches(
  direction: ResearchConclusionV1['direction'],
  hypothesis: TimeSeriesRelationshipQuestionSpecV1['hypothesis']['direction'],
): boolean {
  if (hypothesis === 'two_sided') {
    return direction !== 'none';
  }
  return direction === hypothesis;
}

function relationshipEffectSize(
  result: TimeSeriesRelationshipResultV1,
): ResearchConclusionV1['effectSize'] {
  const metric = result.pearson == null ? 'spearman' : 'pearson';
  const value = result[metric];
  if (value == null) {
    throw new Error('time_series_relationship conclusion requires a correlation effect size');
  }
  const absolute = Math.abs(value);
  const magnitude =
    absolute < 0.1
      ? 'negligible'
      : absolute < 0.3
        ? 'small'
        : absolute < 0.5
          ? 'moderate'
          : 'large';
  return { metric, value, magnitude };
}

function rollingStability(
  result: TimeSeriesRelationshipResultV1,
  direction: ResearchConclusionV1['direction'],
): ResearchConclusionV1['stability'] {
  const slopes = result.rolling
    .map((point) => point.slope)
    .filter((slope): slope is number => slope != null && Number.isFinite(slope));
  if (slopes.length === 0 || direction === 'none') {
    return {
      method: 'rolling_sign_consistency',
      windows: slopes.length,
      consistentFraction: null,
      assessment: 'not_assessed',
    };
  }
  const consistent = slopes.filter((slope) =>
    direction === 'positive' ? slope > 0 : slope < 0,
  ).length;
  const consistentFraction = consistent / slopes.length;
  return {
    method: 'rolling_sign_consistency',
    windows: slopes.length,
    consistentFraction,
    assessment: consistentFraction >= 0.75 ? 'stable' : 'unstable',
  };
}

function conclusionLimitations(
  diagnostics: ResearchDiagnosticV1[],
  stability: ResearchConclusionV1['stability']['assessment'],
): Pick<ResearchConclusionV1, 'limitationsZh' | 'limitationsEn'> {
  const limitationsZh = ['变量关系不等同于因果关系或可交易的预测能力。'];
  const limitationsEn = [
    'An observed relationship is not causal evidence or proof of tradable predictability.',
  ];
  if (stability === 'not_assessed') {
    limitationsZh.push('本次未产生可用的滚动窗口结果，无法评价跨时期稳定性。');
    limitationsEn.push(
      'No usable rolling-window result was produced, so stability across periods was not assessed.',
    );
  } else if (stability === 'unstable') {
    limitationsZh.push('滚动窗口中的方向不稳定，全样本估计不能代表所有时期。');
    limitationsEn.push(
      'The direction is unstable across rolling windows; the full-sample estimate is not representative of every period.',
    );
  }
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === 'info') {
      continue;
    }
    limitationsZh.push(diagnostic.messageZh);
    limitationsEn.push(diagnostic.messageEn);
  }
  return { limitationsZh, limitationsEn };
}

function conclusionSummaries(args: {
  level: ResearchConclusionV1['level'];
  direction: ResearchConclusionV1['direction'];
  estimate: number;
  confidenceInterval95: { lower: number; upper: number };
  effectMagnitude: ResearchConclusionV1['effectSize']['magnitude'];
  stability: ResearchConclusionV1['stability'];
}): Pick<ResearchConclusionV1, 'summaryZh' | 'summaryEn'> {
  const estimate = args.estimate.toFixed(4);
  const interval = `[${args.confidenceInterval95.lower.toFixed(4)}, ${args.confidenceInterval95.upper.toFixed(4)}]`;
  const directionZh =
    args.direction === 'positive' ? '正向' : args.direction === 'negative' ? '负向' : '无方向';
  const directionEn =
    args.direction === 'positive'
      ? 'positive'
      : args.direction === 'negative'
        ? 'negative'
        : 'directionless';
  const effectMagnitudeZh = {
    negligible: '可忽略',
    small: '较小',
    moderate: '中等',
    large: '较大',
  }[args.effectMagnitude];
  const stabilityZh =
    args.stability.consistentFraction == null
      ? '未评价滚动稳定性'
      : `滚动方向一致率为 ${(args.stability.consistentFraction * 100).toFixed(1)}%`;
  const stabilityEn =
    args.stability.consistentFraction == null
      ? 'rolling stability was not assessed'
      : `rolling sign consistency is ${(args.stability.consistentFraction * 100).toFixed(1)}%`;

  switch (args.level) {
    case 'supports':
      return {
        summaryZh: `样本支持${directionZh}关系：斜率为 ${estimate}，95% 区间为 ${interval}，效应量${effectMagnitudeZh}，${stabilityZh}。`,
        summaryEn: `The sample supports a ${directionEn} relationship: slope ${estimate}, 95% interval ${interval}, ${args.effectMagnitude} effect size, and ${stabilityEn}.`,
      };
    case 'weak_support':
      return {
        summaryZh: `样本仅弱支持${directionZh}关系：斜率为 ${estimate}，95% 区间为 ${interval}，但效应量或稳定性不足（${stabilityZh}）。`,
        summaryEn: `The sample provides only weak support for a ${directionEn} relationship: slope ${estimate}, 95% interval ${interval}, but effect size or stability is limited (${stabilityEn}).`,
      };
    case 'does_not_support':
      return {
        summaryZh: `样本不支持预设关系：斜率为 ${estimate}，95% 区间为 ${interval}，区间或方向未满足预设假设。`,
        summaryEn: `The sample does not support the prespecified relationship: slope ${estimate}, 95% interval ${interval}; the interval or direction does not satisfy the hypothesis.`,
      };
    case 'indeterminate':
      return {
        summaryZh: `由于关键诊断未通过，本次无法判断预设关系；当前斜率估计为 ${estimate}，95% 区间为 ${interval}。`,
        summaryEn: `The prespecified relationship is indeterminate because a critical diagnostic failed; the current slope estimate is ${estimate} with a 95% interval of ${interval}.`,
      };
  }
}
