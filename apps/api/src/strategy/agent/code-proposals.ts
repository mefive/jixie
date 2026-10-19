import pkg, { type Prisma } from '@prisma/client';
import type { AcceptCodeChangeInput } from '@jixie/shared/api/strategy';
import { prisma } from '#infra/database/prisma.js';
import { AgentError } from '#agent/errors.js';
import {
  acceptCodeProposalRecord,
  codeProposalIdentity,
  codeProposalView,
  readCodeProposal,
} from '#agent/conversations/code-proposals.js';
import { StrategyError } from '../errors.js';
import { StrategyFactor } from '../factors/strategy-factor.js';

const { Prisma: PrismaNamespace } = pkg;

/**
 * 对已保存源码及语言取身份，接受建议不覆盖用户的其他回测配置。
 *
 * Identify saved source and language; accepting a suggestion preserves other backtest settings.
 */
export function strategyCodeIdentity(value: unknown): string {
  const config = strategySourceConfig(value);

  return codeProposalIdentity([
    config.code ?? '',
    config.language ?? 'typescript',
    config.runtimeVersion ?? 'ts-v1',
  ]);
}

export function strategySourceConfig(value: unknown): Record<string, Prisma.JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

export async function getStrategyCodeProposal(
  userId: string,
  strategyId: string,
  proposalId: string,
) {
  return prisma.$transaction(async (transaction) => {
    await ownedStrategy(transaction, userId, strategyId);

    return codeProposalView(
      await readCodeProposal(transaction, userId, 'strategy', strategyId, proposalId),
    );
  });
}

/**
 * 用户接受后保存代码、清理旧结果缓存并标记原建议，不运行回测。
 *
 * Save accepted code, invalidate the old result cache and resolve the proposal without backtesting.
 */
export async function acceptStrategyCodeProposal(
  userId: string,
  strategyId: string,
  proposalId: string,
  input: AcceptCodeChangeInput,
) {
  return prisma.$transaction(async (transaction) => {
    const strategy = await ownedStrategy(transaction, userId, strategyId);
    const proposal = await readCodeProposal(
      transaction,
      userId,
      'strategy',
      strategyId,
      proposalId,
    );
    if (proposal.status === 'accepted') {
      return codeProposalView(proposal);
    }
    if (
      input.beforeCode !== proposal.beforeCode ||
      strategyCodeIdentity(strategy.config) !== proposal.baseIdentity
    ) {
      throw new AgentError('code_proposal_conflict');
    }

    const config = {
      ...strategySourceConfig(strategy.config),
      code: proposal.afterCode,
      language: proposal.language,
      runtimeVersion: proposal.language === 'python' ? 'py-v1' : 'ts-v1',
    };
    await transaction.strategy.update({
      where: { id: strategyId },
      data: {
        config,
        lastResult: PrismaNamespace.DbNull,
        ...(StrategyFactor.extractKeys(proposal.afterCode).length > 0
          ? { visibility: 'private' }
          : {}),
      },
    });

    return acceptCodeProposalRecord(transaction, proposal);
  });
}

async function ownedStrategy(
  transaction: Prisma.TransactionClient,
  userId: string,
  strategyId: string,
) {
  const strategy = await transaction.strategy.findFirst({ where: { id: strategyId, userId } });
  if (!strategy) {
    throw new StrategyError('strategy_not_found');
  }

  return strategy;
}
