import type { MarketRiskDriverQualitySummary } from '../../../market/quality/market-risk-drivers.js';
import type { MacroRiskAxisQualitySummary } from '../../../market/macro/risk-axis-quality.js';
import { MARKET_RISK_LOOKBACK_OBSERVATIONS } from './market-risk-model.js';
import { MACRO_RISK_MINIMUM_OBSERVATIONS } from './macro-risk-model.js';

const MACRO_RISK_AUDIT_HISTORY_MONTHS = MACRO_RISK_MINIMUM_OBSERVATIONS + 12;
const MACRO_RISK_EARLIEST_DATE = '20180326';

// The audit requires a full market-model lookback, not merely the minimum fit sample.
export function marketRiskDataReadiness(quality: MarketRiskDriverQualitySummary): string[] {
  return quality.completeObservations < MARKET_RISK_LOOKBACK_OBSERVATIONS
    ? [`only ${quality.completeObservations} complete observations are available`]
    : [];
}

export function macroRiskDataReadiness(quality: MacroRiskAxisQualitySummary) {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (quality.exploratoryCompleteObservations < MACRO_RISK_MINIMUM_OBSERVATIONS) {
    errors.push(
      `only ${quality.exploratoryCompleteObservations} complete exploratory macro-axis changes are available`,
    );
  }
  const insufficientAxes = quality.axes.filter(
    (axis) => axis.exploratoryObservations < MACRO_RISK_MINIMUM_OBSERVATIONS,
  );
  if (insufficientAxes.length > 0) {
    errors.push(
      `insufficient exploratory axes: ${insufficientAxes.map((axis) => axis.axis).join(', ')}`,
    );
  }
  if (quality.strictCompleteObservations < MACRO_RISK_MINIMUM_OBSERVATIONS) {
    warnings.push(
      `strict PIT history has ${quality.strictCompleteObservations}/${MACRO_RISK_MINIMUM_OBSERVATIONS} required complete observations while local vintages accumulate`,
    );
  }
  return { errors, warnings };
}

export function selectMacroRiskAuditStart(startDate: string, endDate: string): string {
  const end = new Date(
    Date.UTC(
      Number(endDate.slice(0, 4)),
      Number(endDate.slice(4, 6)) - 1,
      Number(endDate.slice(6, 8)),
    ),
  );
  end.setUTCMonth(end.getUTCMonth() - MACRO_RISK_AUDIT_HISTORY_MONTHS);
  const requiredStart = [
    end.getUTCFullYear(),
    String(end.getUTCMonth() + 1).padStart(2, '0'),
    String(end.getUTCDate()).padStart(2, '0'),
  ].join('');
  const requestedStart = startDate < requiredStart ? startDate : requiredStart;
  return requestedStart > MACRO_RISK_EARLIEST_DATE ? requestedStart : MACRO_RISK_EARLIEST_DATE;
}
