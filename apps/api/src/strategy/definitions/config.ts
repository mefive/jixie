import type { BacktestConfig } from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { backtestSettingsSchema } from '@jixie/shared/api/strategy';
export type StrategyDatabase = Pick<Prisma.TransactionClient, 'strategy'>;

/**
 * 为影响回测结果的所有输入生成稳定身份，显示名称不参与。
 *
 * Stable identity of every input that can change a backtest result. The display name is excluded.
 */
export function strategyRunKey(config: unknown): string {
  const candidate = config as Partial<BacktestConfig> | null;
  const cost = candidate?.cost;
  return JSON.stringify({
    start: candidate?.start,
    end: candidate?.end,
    initialCash: candidate?.initialCash,
    language: candidate?.language ?? 'typescript',
    runtimeVersion: candidate?.runtimeVersion ?? 'ts-v1',
    cost: cost
      ? {
          commission: cost.commission,
          minCommission: cost.minCommission,
          stampDuty: cost.stampDuty,
          transferFee: cost.transferFee,
          slippageBps: cost.slippageBps,
          impactCoef: cost.impactCoef,
        }
      : undefined,
    code: candidate?.code,
  });
}

/**
 * 只为当前输出过期检测生成摘要，不保存或恢复源码。
 *
 * Hash inputs only to detect stale output, never to archive or restore source.
 */
export function strategyInputSignature(config: unknown): string {
  return createHash('sha256').update(strategyRunKey(config)).digest('hex');
}

/**
 * 保存运行参数并排除源码及未知字段。
 *
 * Retain run settings without source or unknown fields.
 */
export function strategyResultSettings(config: unknown) {
  return backtestSettingsSchema.parse(config);
}

/**
 * 按用户归属保存当前可编辑配置，不改写已有结果。
 *
 * Save the current editable configuration by owner-scoped ID without rewriting retained results.
 */
export async function commitStrategyConfig(
  database: StrategyDatabase,
  userId: string,
  id: string,
  config: BacktestConfig,
) {
  const existing = await database.strategy.findFirst({
    where: { id, userId },
    select: { config: true, name: true },
  });
  if (!existing) {
    return null;
  }

  let name = config.name;
  if (name !== existing.name) {
    const taken = await database.strategy.findUnique({
      where: { userId_name: { userId, name } },
      select: { id: true },
    });
    if (taken && taken.id !== id) {
      name = existing.name;
    }
  }
  const nextConfig = { ...config, name };
  const data: Prisma.StrategyUpdateInput = {
    name,
    config: nextConfig as unknown as Prisma.InputJsonValue,
  };

  return database.strategy.update({
    where: { id },
    data,
    select: { id: true, name: true, createdAt: true, updatedAt: true },
  });
}
