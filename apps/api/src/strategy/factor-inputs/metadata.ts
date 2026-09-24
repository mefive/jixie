import type { FactorDependency } from '@jixie/shared';
import { isResearchOnlyFactorV2Field } from '#factor/definitions/fields.js';
import type { CustomFactorModule } from '#engine/factors/custom-factor.js';
import type { FactorDefinition } from '#engine/factors/execution-port.js';
import { StrategyError } from '../errors.js';

/** Join runtime metadata to prepared source without transferring ownership of live runtimes. */
export function resolveStrategyFactorMetadata(
  modules: CustomFactorModule[],
  dependencies: FactorDependency[],
  definitions: FactorDefinition[],
): { modules: CustomFactorModule[]; factors: FactorDependency[] } {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const resolved = modules.map((module) => {
    const definition = byId.get(module.key);
    if (!definition) {
      throw new Error(`Missing factor metadata: ${module.key}`);
    }
    return resolveModule(module, definition);
  });
  const byKey = new Map(resolved.map((module) => [module.key, module]));
  const researchOnlyInputs = [
    ...new Set(
      resolved.flatMap((module) =>
        (module.assetSeries?.inputs ?? []).filter(isResearchOnlyFactorV2Field),
      ),
    ),
  ];
  if (researchOnlyInputs.length > 0) {
    throw new StrategyError('research_only_inputs_unavailable', {
      params: { fields: researchOnlyInputs.join(', ') },
    });
  }
  return {
    modules: resolved,
    factors: dependencies.map((dependency) => {
      const module = byKey.get(dependency.key);
      if (!module) {
        throw new Error(`Missing factor metadata: ${dependency.key}`);
      }
      return {
        ...dependency,
        ...(module.assetSeries ? { inputs: [...module.assetSeries.inputs] } : {}),
      };
    }),
  };
}

function resolveModule(
  module: CustomFactorModule,
  definition: FactorDefinition,
): CustomFactorModule {
  switch (definition.kind) {
    case 'cross_sectional':
      return { ...module, crossSectional: { window: definition.window } };
    case 'asset_series':
      return {
        ...module,
        assetSeries: { ...definition.meta, inputs: [...definition.meta.inputs] },
      };
    case 'panel_composite':
      return {
        ...module,
        assetSeries: {
          window: Math.max(
            ...definition.components.map((component) => component.definition.meta.window),
          ),
          inputs: [
            ...new Set(
              definition.components.flatMap((component) => component.definition.meta.inputs),
            ),
          ],
        },
      };
  }
}
