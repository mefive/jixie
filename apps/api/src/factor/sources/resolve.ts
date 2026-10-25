import { getDatabase } from '#infra/database/prisma.js';
import { BUILTIN_USER_ID } from '../definitions/builtin-factors.js';
import { factorCompositeDefinitionV1Schema } from '@jixie/shared/api/factor';
import { type FactorAnalysisSource } from './snapshot.js';
import {
  COMMODITY_CARRY_FIELD,
  COMMODITY_WAREHOUSE_RECEIPT_VOLUME_FIELD,
} from '../definitions/fields.js';
import { type AssetFactorDataRequirements } from '../observations/asset-factor-data-cutoff.js';

/**
 * 从冻结来源协议推导实际数据需求，供截止日与预载使用。
 *
 * Resolve dataset requirements from the frozen source protocol.
 */
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

/**
 * 按来源种类解析因子定义与快照，并验证访问权限。
 *
 * Resolve factor definitions and snapshots by source kind with access checks.
 */
export async function resolveFactorSource(
  userId: string,
  factorId: string,
): Promise<FactorAnalysisSource | null> {
  const custom = await getDatabase().factor.findFirst({
    where: { id: factorId, userId: { in: [userId, BUILTIN_USER_ID] } },
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
  const composite = await getDatabase().factorComposite.findFirst({
    where: { id: factorId, userId: { in: [userId, BUILTIN_USER_ID] } },
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

/**
 * 读取可访问的已保存时间序列因子来源。
 *
 * Read an accessible saved time-series factor source.
 */
export async function resolveTimeSeriesFactorSource(
  userId: string,
  factorId: string,
): Promise<FactorAnalysisSource | null> {
  const custom = await getDatabase().factor.findFirst({
    where: { id: factorId, userId: { in: [userId, BUILTIN_USER_ID] }, analysisKind: 'time_series' },
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
