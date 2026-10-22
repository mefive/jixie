import type { Prisma } from '@prisma/client';
import type { AcceptCodeChangeInput } from '@jixie/shared/api/factor';
import { getDatabase } from '#infra/database/prisma.js';
import { AgentError } from '#agent/errors.js';
import {
  acceptCodeProposalRecord,
  codeProposalIdentity,
  codeProposalView,
  readCodeProposal,
} from '#agent/conversations/code-proposals.js';
import { FactorError } from '../errors.js';

/**
 * 固定因子源码和计算协议，消息及显示元数据变化不使建议过期。
 *
 * Bind source and computation semantics without invalidating on display or message updates.
 */
export function factorCodeIdentity(factor: {
  code: string;
  language: string;
  runtimeVersion: string;
  analysisKind: string;
}): string {
  return codeProposalIdentity([
    factor.code,
    factor.language,
    factor.runtimeVersion,
    factor.analysisKind,
  ]);
}

export async function getFactorCodeProposal(userId: string, factorId: string, proposalId: string) {
  return getDatabase().$transaction(async (transaction) => {
    await ownedFactor(transaction, userId, factorId);

    return codeProposalView(
      await readCodeProposal(transaction, userId, 'factor', factorId, proposalId),
    );
  });
}

/**
 * 接受时原子核对保存基准与编辑器基准，再修改草稿并记录接受。
 *
 * Atomically check saved and editor baselines before updating the draft and recording acceptance.
 */
export async function acceptFactorCodeProposal(
  userId: string,
  factorId: string,
  proposalId: string,
  input: AcceptCodeChangeInput,
) {
  return getDatabase().$transaction(async (transaction) => {
    const factor = await ownedFactor(transaction, userId, factorId);
    const proposal = await readCodeProposal(transaction, userId, 'factor', factorId, proposalId);
    if (proposal.status === 'accepted') {
      return codeProposalView(proposal);
    }
    if (factor.status !== 'draft') {
      throw new FactorError('published_factor_readonly');
    }
    if (
      input.beforeCode !== proposal.beforeCode ||
      factorCodeIdentity(factor) !== proposal.baseIdentity
    ) {
      throw new AgentError('code_proposal_conflict');
    }

    if (await transaction.factorWeatherPin.count({ where: { factorId } })) {
      throw new FactorError('pinned_factor_readonly_edit');
    }

    await transaction.factor.update({
      where: { id: factorId },
      data: { code: proposal.afterCode },
    });

    return acceptCodeProposalRecord(transaction, proposal);
  });
}

async function ownedFactor(
  transaction: Prisma.TransactionClient,
  userId: string,
  factorId: string,
) {
  const factor = await transaction.factor.findFirst({ where: { id: factorId, userId } });
  if (!factor) {
    throw new FactorError('factor_not_found');
  }

  return factor;
}
