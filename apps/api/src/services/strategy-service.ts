import { ulid } from 'ulid';
import type { BacktestConfig, Locale } from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import pkg from '@prisma/client';
import { chatText } from '../llm/deepseek.js';
import { prisma } from '../lib/prisma.js';

const { Prisma: PrismaNs } = pkg;

type StrategyDatabase = Pick<Prisma.TransactionClient, 'strategy'>;

/** Stable identity of every input that can change a backtest result. The display name is excluded. */
export function strategyRunKey(config: unknown): string {
  const candidate = config as Partial<BacktestConfig> | null;
  const cost = candidate?.cost;
  return JSON.stringify({
    start: candidate?.start,
    end: candidate?.end,
    initialCash: candidate?.initialCash,
    cost: cost
      ? {
          commission: cost.commission,
          minCommission: cost.minCommission,
          stampDuty: cost.stampDuty,
          transferFee: cost.transferFee,
          futureCommissionRate: cost.futureCommissionRate,
          futureCloseTodayRate: cost.futureCloseTodayRate,
          futureSlippageTicks: cost.futureSlippageTicks,
          futureMarginRate: cost.futureMarginRate,
        }
      : undefined,
    code: candidate?.code,
  });
}

/** Ask the naming model for a short localized strategy name. */
export async function proposeStrategyName(input: {
  code?: string;
  prompt?: string;
  currentName?: string;
  locale: Locale;
}): Promise<string> {
  const { code, prompt, currentName, locale } = input;
  if (!code && !prompt) {
    throw new Error('code or prompt required');
  }

  const nameLanguageHint =
    locale === 'en' ? 'a short English name (≤5 words)' : 'a short Chinese name (≤14 chars)';
  const messages =
    code != null
      ? [
          {
            role: 'system' as const,
            content: currentName
              ? `You name A-share strategies. Read the strategy code; it is currently called "${currentName}". If that name still accurately summarizes the code's selection/timing/trading logic, **return it unchanged**; only when the logic has clearly drifted, propose a more fitting ${nameLanguageHint}. Output only the name itself — no quotes, no explanation, no trailing punctuation.`
              : `You name A-share strategies. Read the strategy code and propose ${nameLanguageHint} summarizing its selection/timing/trading logic. Output only the name itself — no quotes, no explanation, no trailing punctuation.`,
          },
          { role: 'user' as const, content: code },
        ]
      : [
          {
            role: 'system' as const,
            content: `You name A-share strategies. Read the user's natural-language strategy request and propose ${nameLanguageHint} summarizing its selection/timing/trading intent. Output only the name itself — no quotes, no explanation, no trailing punctuation.`,
          },
          { role: 'user' as const, content: prompt! },
        ];
  const raw = await chatText(messages);

  return raw
    .trim()
    .replace(/^["'「『]+|["'」』。.]+$/g, '')
    .slice(0, 20);
}

/** Make a generated name unique within one user's strategy collection. */
export async function uniqueStrategyName(
  database: StrategyDatabase,
  userId: string,
  base: string,
  strategyId?: string,
): Promise<string> {
  for (let suffix = 1; suffix <= 50; suffix++) {
    const name = suffix === 1 ? base : `${base} ${suffix}`;
    const taken = await database.strategy.findUnique({
      where: { userId_name: { userId, name } },
      select: { id: true },
    });
    if (!taken || taken.id === strategyId) {
      return name;
    }
  }

  return `${base} ${ulid().slice(-4)}`;
}

/** Commit the runnable snapshot by owner-scoped id and invalidate a result produced by older inputs. */
export async function commitStrategyConfig(
  database: StrategyDatabase,
  userId: string,
  id: string,
  config: BacktestConfig,
  messages?: Prisma.InputJsonValue,
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

/** Rename only if the row still contains the config snapshot that requested this proposal. */
export async function refreshStrategyName(input: {
  id: string;
  userId: string;
  code: string;
  currentName: string;
  expectedRunKey: string;
  locale: Locale;
}): Promise<boolean> {
  const proposedName = await proposeStrategyName({
    code: input.code,
    currentName: input.currentName,
    locale: input.locale,
  });
  if (!proposedName || proposedName === input.currentName) {
    return false;
  }

  return prisma.$transaction(async (transaction) => {
    const current = await transaction.strategy.findFirst({
      where: { id: input.id, userId: input.userId },
      select: { config: true, name: true },
    });
    if (!current || strategyRunKey(current.config) !== input.expectedRunKey) {
      return false;
    }

    const taken = await transaction.strategy.findUnique({
      where: { userId_name: { userId: input.userId, name: proposedName } },
      select: { id: true },
    });
    const name = taken && taken.id !== input.id ? current.name : proposedName;
    if (name === current.name) {
      return false;
    }
    const config = current.config as unknown as BacktestConfig;
    await transaction.strategy.update({
      where: { id: input.id },
      data: {
        name,
        config: { ...config, name } as unknown as Prisma.InputJsonValue,
      },
    });
    return true;
  });
}
