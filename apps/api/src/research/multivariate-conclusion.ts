import type {
  MultivariateTimeSeriesConclusionV1,
  MultivariateTimeSeriesQuestionSpecV1,
  MultivariateTimeSeriesRelationshipResultV1,
  ResearchDiagnosticV1,
} from '@jixie/shared';

export function concludeMultivariateTimeSeriesRelationship(
  question: MultivariateTimeSeriesQuestionSpecV1,
  result: MultivariateTimeSeriesRelationshipResultV1,
  diagnostics: ResearchDiagnosticV1[],
): MultivariateTimeSeriesConclusionV1 {
  const focal = result.coefficients.find(
    (coefficient) => coefficient.inputId === question.hypothesis.focalPredictor,
  );
  if (!focal) {
    throw new Error('multivariate conclusion requires the prespecified focal predictor');
  }
  const intervalExcludesNull =
    focal.confidenceInterval95.lower > 0 || focal.confidenceInterval95.upper < 0;
  const direction = focal.estimate > 0 ? 'positive' : focal.estimate < 0 ? 'negative' : 'none';
  const hypothesisDirectionMatches =
    question.hypothesis.direction === 'two_sided' || question.hypothesis.direction === direction;
  const magnitude = partialRSquaredMagnitude(focal.partialRSquared);
  const rollingSigns = result.rolling.map((point) => Math.sign(point.estimate));
  const focalSign = Math.sign(focal.estimate);
  const consistentFraction =
    rollingSigns.length === 0 || focalSign === 0
      ? null
      : rollingSigns.filter((sign) => sign === focalSign).length / rollingSigns.length;
  const stabilityAssessment =
    consistentFraction == null ? 'not_assessed' : consistentFraction >= 0.7 ? 'stable' : 'unstable';
  const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  const level = hasErrors
    ? 'indeterminate'
    : !intervalExcludesNull || !hypothesisDirectionMatches
      ? 'does_not_support'
      : magnitude === 'negligible' || stabilityAssessment === 'unstable'
        ? 'weak_support'
        : 'supports';
  const rationaleCodes = [
    intervalExcludesNull ? 'interval_excludes_null' : 'interval_includes_null',
    hypothesisDirectionMatches ? 'direction_matches' : 'direction_mismatch',
    `effect_${magnitude}`,
    `stability_${stabilityAssessment}`,
    ...(hasErrors ? ['diagnostic_error'] : []),
  ];
  const summaries = conclusionSummaries({
    level,
    direction,
    focalPredictor: focal.inputId,
    estimate: focal.estimate,
    interval: focal.confidenceInterval95,
    partialRSquared: focal.partialRSquared,
    stability: consistentFraction,
  });
  const limitationsZh = [
    '这是控制已纳入变量后的条件相关关系，不是因果结论。',
    '未观测变量、变量变换、滞后口径和样本区间仍可能改变估计。',
    '控制变量由研究计划预先指定；系统没有根据显著性自动增删变量。',
  ];
  const limitationsEn = [
    'This is a conditional association after included controls, not a causal conclusion.',
    'Unobserved variables, transformations, lag choices, and the sample window may still change the estimate.',
    'Controls were prespecified in the research plan; the system did not add or remove variables based on significance.',
  ];
  if (stabilityAssessment === 'not_assessed') {
    limitationsZh.push('本次未产生可用的滚动窗口结果，无法评价跨时期稳定性。');
    limitationsEn.push(
      'No usable rolling-window result was produced, so stability across periods was not assessed.',
    );
  } else if (stabilityAssessment === 'unstable') {
    limitationsZh.push('核心变量的滚动系数方向不稳定，全样本估计不能代表所有时期。');
    limitationsEn.push(
      'The focal coefficient changes direction across rolling windows; the full-sample estimate is not representative of every period.',
    );
  }
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === 'info') {
      continue;
    }
    limitationsZh.push(diagnostic.messageZh);
    limitationsEn.push(diagnostic.messageEn);
  }

  return {
    version: 1,
    level,
    direction,
    estimand: 'partial_regression_coefficient',
    focalPredictor: focal.inputId,
    estimate: focal.estimate,
    confidenceInterval95: focal.confidenceInterval95,
    intervalExcludesNull,
    hypothesisDirectionMatches,
    effectSize: {
      metric: 'partial_r_squared',
      value: focal.partialRSquared,
      magnitude,
    },
    stability: {
      method: 'rolling_sign_consistency',
      windows: result.rolling.length,
      consistentFraction,
      assessment: stabilityAssessment,
    },
    rationaleCodes,
    ...summaries,
    limitationsZh,
    limitationsEn,
  };
}

function partialRSquaredMagnitude(
  value: number,
): MultivariateTimeSeriesConclusionV1['effectSize']['magnitude'] {
  const absolute = Math.abs(value);
  if (absolute < 0.01) {
    return 'negligible';
  }
  if (absolute < 0.09) {
    return 'small';
  }
  if (absolute < 0.25) {
    return 'moderate';
  }
  return 'large';
}

function conclusionSummaries(args: {
  level: MultivariateTimeSeriesConclusionV1['level'];
  direction: MultivariateTimeSeriesConclusionV1['direction'];
  focalPredictor: string;
  estimate: number;
  interval: { lower: number; upper: number };
  partialRSquared: number;
  stability: number | null;
}): Pick<MultivariateTimeSeriesConclusionV1, 'summaryZh' | 'summaryEn'> {
  const estimate = args.estimate.toFixed(4);
  const interval = `[${args.interval.lower.toFixed(4)}, ${args.interval.upper.toFixed(4)}]`;
  const directionZh =
    args.direction === 'positive' ? '正向' : args.direction === 'negative' ? '负向' : '无方向';
  const directionEn =
    args.direction === 'positive'
      ? 'positive'
      : args.direction === 'negative'
        ? 'negative'
        : 'directionless';
  const stabilityZh =
    args.stability == null
      ? '滚动稳定性未评价'
      : `滚动方向一致率 ${(args.stability * 100).toFixed(1)}%`;
  const stabilityEn =
    args.stability == null
      ? 'rolling stability was not assessed'
      : `rolling sign consistency ${(args.stability * 100).toFixed(1)}%`;
  const evidenceZh = `偏回归系数 ${estimate}，95% 区间 ${interval}，偏 R² ${(args.partialRSquared * 100).toFixed(2)}%，${stabilityZh}`;
  const evidenceEn = `partial coefficient ${estimate}, 95% interval ${interval}, partial R² ${(args.partialRSquared * 100).toFixed(2)}%, ${stabilityEn}`;

  switch (args.level) {
    case 'supports':
      return {
        summaryZh: `控制其他预设变量后，样本支持 ${args.focalPredictor} 与结果变量存在${directionZh}关系：${evidenceZh}。`,
        summaryEn: `After controlling for the other prespecified variables, the sample supports a ${directionEn} relationship for ${args.focalPredictor}: ${evidenceEn}.`,
      };
    case 'weak_support':
      return {
        summaryZh: `控制其他预设变量后，样本仅弱支持 ${args.focalPredictor} 的${directionZh}关系：${evidenceZh}；效应量或跨时期稳定性不足。`,
        summaryEn: `After controlling for the other prespecified variables, the sample provides only weak support for a ${directionEn} relationship for ${args.focalPredictor}: ${evidenceEn}; effect size or stability is limited.`,
      };
    case 'does_not_support':
      return {
        summaryZh: `控制其他预设变量后，样本不支持关于 ${args.focalPredictor} 的预设关系：${evidenceZh}。`,
        summaryEn: `After controlling for the other prespecified variables, the sample does not support the prespecified relationship for ${args.focalPredictor}: ${evidenceEn}.`,
      };
    case 'indeterminate':
      return {
        summaryZh: `由于关键诊断未通过，暂时无法判断 ${args.focalPredictor} 的预设关系；当前${evidenceZh}。`,
        summaryEn: `A critical diagnostic failed, so the prespecified relationship for ${args.focalPredictor} is indeterminate; current ${evidenceEn}.`,
      };
  }
}
