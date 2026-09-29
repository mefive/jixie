import type { FactorDefinition } from './execution-port.js';
import type { EngineDataRequirements } from '../data/engine-data.js';

export function collectFactorDataRequirements(
  definitions: readonly FactorDefinition[],
): EngineDataRequirements {
  const requirements = {
    turnoverRateFHistory: false,
    fundamentalHistory: false,
    governmentYieldCurve: false,
  };

  for (const definition of definitions) {
    switch (definition.kind) {
      case 'cross_sectional':
        requirements.turnoverRateFHistory ||= definition.historyFields.includes('turnoverRateF');
        requirements.fundamentalHistory ||= definition.historyFields.some(
          (field) => field === 'roe' || field === 'grossprofitMargin',
        );
        break;
      case 'asset_series':
        requirements.governmentYieldCurve ||= definition.meta.inputs.some((field) =>
          field.startsWith('rates.cgb.yield.'),
        );
        break;
      case 'panel_composite':
        requirements.governmentYieldCurve ||= definition.components.some((component) =>
          component.definition.meta.inputs.some((field) => field.startsWith('rates.cgb.yield.')),
        );
        break;
    }
  }

  return requirements;
}
