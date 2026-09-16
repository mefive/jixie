import {
  MACRO_RISK_AXIS_KEYS_V1,
  MARKET_RISK_FACTOR_KEYS_V1,
  isMacroRiskAxisKeyV1,
  isMarketRiskFactorKeyV1,
  type PortfolioRiskAnalysisV1,
} from '@jixie/shared';
import { describe, expect, it } from 'vitest';

describe('Phase 5 risk research contract', () => {
  it('keeps daily market factors distinct from monthly macro axes', () => {
    expect(new Set(MARKET_RISK_FACTOR_KEYS_V1).size).toBe(MARKET_RISK_FACTOR_KEYS_V1.length);
    expect(new Set(MACRO_RISK_AXIS_KEYS_V1).size).toBe(MACRO_RISK_AXIS_KEYS_V1.length);
    expect(MARKET_RISK_FACTOR_KEYS_V1.some((key) => isMacroRiskAxisKeyV1(key))).toBe(false);
    expect(MACRO_RISK_AXIS_KEYS_V1.some((key) => isMarketRiskFactorKeyV1(key))).toBe(false);
  });

  it('recognizes only frozen V1 identifiers', () => {
    expect(isMarketRiskFactorKeyV1('credit_spread')).toBe(true);
    expect(isMarketRiskFactorKeyV1('inflation')).toBe(false);
    expect(isMacroRiskAxisKeyV1('inflation')).toBe(true);
    expect(isMacroRiskAxisKeyV1('credit_spread')).toBe(false);
  });

  it('allows a legacy-compatible partial report without fabricating unavailable sections', () => {
    const report: PortfolioRiskAnalysisV1 = {
      version: 1,
      separationPolicy: 'daily_market_risk_and_monthly_macro_sensitivity',
    };

    expect(report.market).toBeUndefined();
    expect(report.macro).toBeUndefined();
    expect(report.scenarios).toBeUndefined();
  });
});
