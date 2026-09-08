import { prisma } from '../../infra/database/prisma.js';
import { BUILTIN_FACTORS } from '../definitions/builtin-factors.js';
import { factorCompositeDefinitionV1Schema } from '../reports/spec.js';
import { type FactorAnalysisSource } from '../analysis-job.js';
import {
  COMMODITY_CARRY_FIELD,
  COMMODITY_WAREHOUSE_RECEIPT_VOLUME_FIELD,
} from '../definitions/fields.js';
import { type AssetFactorDataRequirements } from '../observations/asset-factor-data-cutoff.js';

export function factorAnalysisSourceDataRequirements(
  source: FactorAnalysisSource,
): AssetFactorDataRequirements {
  const codes =
    source.kind === 'time_series' || source.kind === 'panel'
      ? [source.code]
      : source.kind === 'panel_composite'
        ? source.components.map((component) => component.code)
        : [];
  return codes.reduce<AssetFactorDataRequirements>(
    (requirements, code) => ({
      commodityCarry: requirements.commodityCarry || code.includes(COMMODITY_CARRY_FIELD),
      commodityWarehouseReceipts:
        requirements.commodityWarehouseReceipts ||
        code.includes(COMMODITY_WAREHOUSE_RECEIPT_VOLUME_FIELD),
    }),
    {},
  );
}

export function factorCodeDataRequirements(code: string): AssetFactorDataRequirements {
  return {
    commodityCarry: code.includes(COMMODITY_CARRY_FIELD),
    commodityWarehouseReceipts: code.includes(COMMODITY_WAREHOUSE_RECEIPT_VOLUME_FIELD),
  };
}

export async function resolveFactorSource(
  userId: string,
  factorId: string,
): Promise<FactorAnalysisSource | null> {
  const builtin = BUILTIN_FACTORS.find((factor) => factor.key === factorId);
  if (builtin) {
    return {
      kind: 'single',
      code: builtin.code,
      label: builtin.label,
      language: 'typescript',
      runtimeVersion: 'ts-v1',
    };
  }
  const custom = await prisma.factor.findFirst({
    where: { id: factorId, userId },
    select: {
      code: true,
      name: true,
      analysisKind: true,
      language: true,
      runtimeVersion: true,
    },
  });

  if (custom && custom.analysisKind !== 'time_series' && custom.analysisKind !== 'panel') {
    return {
      kind: 'single',
      code: custom.code,
      label: custom.name,
      language: custom.language === 'python' ? 'python' : 'typescript',
      runtimeVersion: custom.runtimeVersion === 'py-v1' ? 'py-v1' : 'ts-v1',
    };
  }
  const composite = await prisma.factorComposite.findFirst({
    where: { id: factorId, userId },
    select: { name: true, definition: true },
  });
  if (!composite) {
    return null;
  }
  const definition = factorCompositeDefinitionV1Schema.parse(composite.definition);
  const components: Extract<FactorAnalysisSource, { kind: 'composite' }>['components'] = [];
  for (const component of definition.components) {
    const source = await resolveFactorSource(userId, component.factor);
    if (!source || source.kind !== 'single') {
      return null;
    }
    components.push({
      factor: component.factor,
      code: source.code,
      label: source.label,
      direction: component.direction,
      language: source.language,
      runtimeVersion: source.runtimeVersion,
    });
  }
  return {
    kind: 'composite',
    label: composite.name,
    definition,
    components,
  };
}

export async function resolveCustomTimeSeriesFactorSource(
  userId: string,
  factorId: string,
): Promise<FactorAnalysisSource | null> {
  const custom = await prisma.factor.findFirst({
    where: { id: factorId, userId, analysisKind: 'time_series' },
    select: { code: true, name: true, language: true, runtimeVersion: true },
  });
  return custom
    ? {
        kind: 'time_series',
        code: custom.code,
        label: custom.name,
        language: custom.language === 'python' ? 'python' : 'typescript',
        runtimeVersion: custom.runtimeVersion === 'py-v1' ? 'py-v1' : 'ts-v1',
      }
    : null;
}
