import {
  MACRO_RISK_AXIS_KEYS_V1,
  isMacroRiskAxisKeyV1,
  type PortfolioRiskAnalysisV1,
} from '@jixie/shared';
import { describe, expect, it } from 'vitest';

describe('monthly macro research contract', () => {
  it('accepts only the existing monthly macro axes', () => {
    expect(new Set(MACRO_RISK_AXIS_KEYS_V1).size).toBe(MACRO_RISK_AXIS_KEYS_V1.length);
    expect(isMacroRiskAxisKeyV1('inflation')).toBe(true);
    expect(isMacroRiskAxisKeyV1('credit_spread')).toBe(false);
  });

  it('allows unavailable macro analysis without fabricating results', () => {
    const report: PortfolioRiskAnalysisV1 = {
      version: 1,
      separationPolicy: 'daily_market_risk_and_monthly_macro_sensitivity',
    };

    expect(report.macro).toBeUndefined();
  });
});
