import { getDatabase } from '#infra/database/prisma.js';
import { BUILTIN_USER_ID } from '../definitions/builtin-factors.js';
import { type FactorAnalysisSource } from './snapshot.js';

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
