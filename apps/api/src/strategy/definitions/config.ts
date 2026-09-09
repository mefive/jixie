import type { BacktestConfig } from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import pkg from '@prisma/client';
const { Prisma: PrismaNs } = pkg;
export type StrategyDatabase = Pick<Prisma.TransactionClient, 'strategy'>;

/** Stable identity of every input that can change a backtest result. The display name is excluded. */
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
          futureCommissionRate: cost.futureCommissionRate,
          futureCloseTodayRate: cost.futureCloseTodayRate,
          futureSlippageTicks: cost.futureSlippageTicks,
          futureMarginRate: cost.futureMarginRate,
        }
      : undefined,
    code: candidate?.code,
  });
}

/** Commit the runnable snapshot by owner-scoped id and invalidate a result produced by older inputs. */
export async function commitStrategyConfig(
  database: StrategyDatabase,
  userId: string,
  id: string,
  config: BacktestConfig,
  messages?: Prisma.InputJsonValue,
  options?: { forcePrivate?: boolean },
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
    ...(messages !== undefined ? { messages } : {}),
    ...(options?.forcePrivate ? { visibility: 'private' } : {}),
  };
  if (strategyRunKey(existing.config) !== strategyRunKey(nextConfig)) {
    data.lastResult = PrismaNs.DbNull;
  }

  return database.strategy.update({
    where: { id },
    data,
    select: { id: true, name: true, createdAt: true, updatedAt: true },
  });
}
