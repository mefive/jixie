import { getDatabase } from '#infra/database/prisma.js';
import type { FactorAnalysisSource } from '../sources/snapshot.js';
import { BUILTIN_USER_ID } from '../definitions/builtin-factors.js';
import { factorPanelCompositeDefinitionV2Schema } from '@jixie/shared/api/factor';

/**
 * 解析 Panel 组合来源与冻结依赖，供评估复用一致输入。
 *
 * Resolve panel composite sources and frozen dependencies for evaluation.
 */
export async function resolvePanelFactorSource(
  userId: string,
  factorId: string,
): Promise<FactorAnalysisSource | null> {
  const single = await resolveStoredPanelSource(userId, factorId);
  if (single) {
    return single;
  }

  const composite = await getDatabase().factorComposite.findFirst({
    where: { id: factorId, userId },
    select: { name: true, definition: true },
  });
  if (!composite) {
    return null;
  }
  const definition = factorPanelCompositeDefinitionV2Schema.safeParse(composite.definition);
  if (!definition.success) {
    return null;
  }
  const components: Extract<FactorAnalysisSource, { kind: 'panel_composite' }>['components'] = [];
  for (const component of definition.data.components) {
    const source = await resolveStoredPanelSource(userId, component.factor);
    if (!source) {
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
    kind: 'panel_composite',
    label: composite.name,
    definition: definition.data,
    components,
  };
}

/**
 * 读取已保存的 Panel 因子来源，校验协议与访问权限。
 *
 * Read a saved panel source and validate its protocol and access.
 */
async function resolveStoredPanelSource(
  userId: string,
  factorId: string,
): Promise<Extract<FactorAnalysisSource, { kind: 'panel' }> | null> {
  const custom = await getDatabase().factor.findFirst({
    where: { id: factorId, userId: { in: [userId, BUILTIN_USER_ID] }, analysisKind: 'panel' },
    select: { code: true, name: true, language: true, runtimeVersion: true },
  });
  return custom
    ? {
        kind: 'panel',
        code: custom.code,
        label: custom.name,
        language: custom.language === 'python' ? 'python' : 'typescript',
        runtimeVersion: custom.runtimeVersion === 'py-v1' ? 'py-v1' : 'ts-v1',
      }
    : null;
}
