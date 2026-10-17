import { DEFAULT_CROSS_SECTIONAL_MINIMUM_WINDOW_COVERAGE } from '../../observations/contract.js';
import * as st from '#math/stats.js';
import type { FactorAnalysisSpec, FactorOutlierSpecV1 } from '@jixie/shared';

// Net-of-cost view (3.4): per-side trading cost estimates for the hypothetical long-short. A round-trip
// (churning one name) = buy side + sell side ≈ 30bps — the first tradability gate for high-turnover
// factors (short-reversal / money-flow) whose paper IC looks good but decays after costs.
export const LEGACY_POLICY = {
  minimumListingDays: 365,
  liquidityDropFraction: 0.25,
  minimumCandidates: 100,
  minimumWindowCoverage: DEFAULT_CROSS_SECTIONAL_MINIMUM_WINDOW_COVERAGE,
  factorExposure: { method: 'none', tailFraction: 0.01, madThreshold: 5 } as FactorOutlierSpecV1,
  forwardReturn: { method: 'winsor', tailFraction: 0.01, madThreshold: 5 } as FactorOutlierSpecV1,
  commissionPerSide: 0.00025,
  stampDutySellSide: 0.0005,
  slippagePerSide: 0.001,
  excludeRiskWarnings: false,
  excludePendingDelisting: false,
};

/**
 * 解析本次分析的异常值与中性化政策，供不同计算入口保持一致。
 *
 * Resolve outlier and neutralization policies shared by evaluation steps.
 */
export function analysisPolicy(spec: FactorAnalysisSpec) {
  if (spec.version === 1) {
    return LEGACY_POLICY;
  }
  return {
    ...spec.universe,
    ...spec.missing,
    ...spec.outliers,
    ...spec.costs,
    excludeRiskWarnings:
      'excludeRiskWarnings' in spec.universe ? spec.universe.excludeRiskWarnings : false,
    excludePendingDelisting:
      'excludePendingDelisting' in spec.universe ? spec.universe.excludePendingDelisting : false,
  };
}

/**
 * 按明确政策处理截面异常值，不修改未声明的数据语义。
 *
 * Apply the declared outlier policy to cross-sectional observations.
 */
export function applyOutlierPolicy(values: number[], policy: FactorOutlierSpecV1): number[] {
  switch (policy.method) {
    case 'none':
      return values.slice();
    case 'winsor':
      return st.winsorize(values, policy.tailFraction);
    case 'mad': {
      if (values.length < 3) {
        return values.slice();
      }
      const median = st.median(values);
      const mad = st.median(values.map((value) => Math.abs(value - median)));
      if (mad === 0) {
        return values.slice();
      }
      const radius = policy.madThreshold * 1.4826 * mad;
      return values.map((value) => Math.max(median - radius, Math.min(median + radius, value)));
    }
  }
}
