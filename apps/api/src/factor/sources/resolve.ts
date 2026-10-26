import { getDatabase } from '#infra/database/prisma.js';
import { BUILTIN_USER_ID } from '../definitions/builtin-factors.js';
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
  return source.kind === 'time_series' || source.kind === 'panel'
    ? factorCodeDataRequirements(source.code)
    : {};
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

  return null;
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

/**
 * 读取已保存的 Panel 因子来源，校验协议与访问权限。
 *
 * Read a saved panel source and validate its protocol and access.
 */
export async function resolvePanelFactorSource(
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
