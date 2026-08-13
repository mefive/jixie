import type {
  EventStudyConclusionV1,
  EventStudyQuestionSpecV1,
  EventStudyResultV1,
  ResearchDiagnosticV1,
} from '@jixie/shared';

export function concludeEventStudy(
  question: EventStudyQuestionSpecV1,
  result: EventStudyResultV1,
  diagnostics: ResearchDiagnosticV1[],
): EventStudyConclusionV1 {
  const estimate = result.aggregate.meanCumulativeAbnormalReturn;
  const confidenceInterval95 = result.aggregate.confidenceInterval95;
  const direction = estimate > 0 ? 'positive' : estimate < 0 ? 'negative' : 'none';
  const intervalExcludesNull = confidenceInterval95.lower > 0 || confidenceInterval95.upper < 0;
  const hypothesisDirectionMatches =
    question.hypothesis.direction === 'two_sided'
      ? direction !== 'none'
      : direction === question.hypothesis.direction;
  const standardized = estimate / result.aggregate.standardDeviation;
  const effectSize = standardizedEffect(standardized);
  const winsorizedEstimate = result.aggregate.winsorizedMeanCumulativeAbnormalReturn;
  const winsorizedDirection =
    winsorizedEstimate > 0 ? 'positive' : winsorizedEstimate < 0 ? 'negative' : 'none';
  const directionMatches = winsorizedDirection === direction;
  const robustness = {
    method: 'winsorized_mean_direction' as const,
    winsorizedEstimate,
    directionMatches,
    positiveFraction: result.aggregate.positiveFraction,
    assessment: (directionMatches ? 'consistent' : 'sensitive') as 'consistent' | 'sensitive',
  };
  const hasFatalDiagnostic = diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  const rationaleCodes: string[] = [];

  let level: EventStudyConclusionV1['level'];
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
    result.observations >= 20
  ) {
    level = 'supports';
    rationaleCodes.push(
      'interval_excludes_null',
      'direction_matches',
      'winsorized_direction_matches',
      'adequate_event_sample',
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
    if (result.observations < 20) {
      rationaleCodes.push('small_event_sample');
    }
  }

  const interval = `[${(confidenceInterval95.lower * 100).toFixed(2)}%, ${(confidenceInterval95.upper * 100).toFixed(2)}%]`;
  const estimatePercent = `${(estimate * 100).toFixed(2)}%`;
  const window = `[${result.eventWindow.start}, ${result.eventWindow.end}]`;
  const limitationsZh = [
    '市场调整异常收益不是严格的因果反事实；同期公司消息、行业变化和事件选择都可能造成混杂。',
    '公告日只有日期粒度，无法区分盘前、盘中或盘后发布；系统统一映射到公告当日或其后首个交易日。',
    `本次只研究本地分红记录中每个报告期的首条预案公告，并对同一股票重叠窗口保留较早事件。`,
    `平均 CAR 的区间按 ${result.aggregate.eventDateClusters} 个事件交易日聚类，但未另行控制同一股票跨期相关。`,
  ];
  const limitationsEn = [
    'Market-adjusted abnormal return is not a causal counterfactual; concurrent company news, industry moves, and event selection may confound the result.',
    'Announcement timestamps have date-level granularity, so pre-market, intraday, and after-market releases cannot be distinguished; the event maps to that day or the next trading day.',
    'This run studies only the first proposal-stage announcement per reporting period in local dividend records and keeps the earlier event when windows overlap for one stock.',
    `The mean-CAR interval clusters ${result.aggregate.eventDateClusters} event trading dates but does not separately control serial dependence across events for one stock.`,
  ];
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity !== 'info') {
      limitationsZh.push(diagnostic.messageZh);
      limitationsEn.push(diagnostic.messageEn);
    }
  }
  const levelLeadZh =
    level === 'supports'
      ? '样本支持预设事件效应'
      : level === 'weak_support'
        ? '样本仅弱支持预设事件效应'
        : level === 'does_not_support'
          ? '样本不支持预设事件效应'
          : '本次无法判断预设事件效应';
  const levelLeadEn =
    level === 'supports'
      ? 'The sample supports the prespecified event effect'
      : level === 'weak_support'
        ? 'The sample provides only weak support for the prespecified event effect'
        : level === 'does_not_support'
          ? 'The sample does not support the prespecified event effect'
          : 'The prespecified event effect is indeterminate';

  return {
    version: 1,
    level,
    direction,
    estimand: 'mean_cumulative_abnormal_return',
    estimate,
    confidenceInterval95,
    intervalExcludesNull,
    hypothesisDirectionMatches,
    effectSize,
    robustness,
    rationaleCodes,
    summaryZh: `${levelLeadZh}：${result.observations} 个有效事件在 ${window} 交易日窗口的平均累计异常收益为 ${estimatePercent}，95% 区间为 ${interval}。`,
    summaryEn: `${levelLeadEn}: ${result.observations} valid events have a mean cumulative abnormal return of ${estimatePercent} over trading-day window ${window}, with a 95% interval of ${interval}.`,
    limitationsZh,
    limitationsEn,
  };
}

function standardizedEffect(value: number): EventStudyConclusionV1['effectSize'] {
  const absolute = Math.abs(value);
  const magnitude =
    absolute < 0.2
      ? 'negligible'
      : absolute < 0.5
        ? 'small'
        : absolute < 0.8
          ? 'moderate'
          : 'large';
  return { metric: 'standardized_mean_car', value, magnitude };
}
