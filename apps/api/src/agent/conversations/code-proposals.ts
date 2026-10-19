import { createHash } from 'node:crypto';
import type { AgentCodeChangeProposal, Prisma } from '@prisma/client';
import { normalizeChatMessage, type CodeChangeProposalV1, type MessagePart } from '@jixie/shared';
import { AgentError } from '../errors.js';

/**
 * 由业务捕获保存状态；编辑器基准与已保存基准分别检查。
 *
 * Capture host storage state separately from the editor source used for generation.
 */
export interface CodeProposalContext {
  surface: 'factor' | 'strategy';
  entityId: string;
  language: 'typescript' | 'python';
  baseIdentity: string;
  beforeCode: string;
}

/**
 * 只对影响代码含义的保存状态取身份，不受消息或显示名刷新影响。
 *
 * Identify saved code semantics independently of message and display-name updates.
 */
export function codeProposalIdentity(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function codeProposalView(row: AgentCodeChangeProposal): CodeChangeProposalV1 {
  return {
    version: 1,
    id: row.id,
    surface: row.surface as CodeChangeProposalV1['surface'],
    entityId: row.entityId,
    language: row.language as CodeChangeProposalV1['language'],
    beforeCode: row.beforeCode,
    afterCode: row.afterCode,
    status: row.status as CodeChangeProposalV1['status'],
    createdAt: row.createdAt.toISOString(),
    ...(row.acceptedAt ? { acceptedAt: row.acceptedAt.toISOString() } : {}),
  };
}

/**
 * 归属检查在读取边界执行；接受后的重试返回同一记录。
 *
 * Authorize at the read boundary and return the same record for accepted retries.
 */
export async function readCodeProposal(
  transaction: Prisma.TransactionClient,
  userId: string,
  surface: CodeProposalContext['surface'],
  entityId: string,
  proposalId: string,
) {
  const proposal = await transaction.agentCodeChangeProposal.findFirst({
    where: { id: proposalId, userId, surface, entityId },
  });
  if (!proposal) {
    throw new AgentError('code_proposal_not_found');
  }

  return proposal;
}

/**
 * 同一事务记录接受并更新来源消息；不追加接受或撤回聊天消息。
 *
 * Record acceptance and update its source message atomically without appending chat messages.
 */
export async function acceptCodeProposalRecord(
  transaction: Prisma.TransactionClient,
  proposal: AgentCodeChangeProposal,
): Promise<CodeChangeProposalV1> {
  const accepted = await transaction.agentCodeChangeProposal.update({
    where: { id: proposal.id },
    data: { status: 'accepted', acceptedAt: new Date() },
  });
  const message = await transaction.agentMessage.findUniqueOrThrow({
    where: { id: proposal.sourceMessageId },
  });
  const view = codeProposalView(accepted);
  const parts: MessagePart[] = normalizeChatMessage(message).parts.map((part) =>
    part.type === 'code_change' && part.proposal.id === proposal.id
      ? { type: 'code_change', proposal: view }
      : part,
  );
  await transaction.agentMessage.update({
    where: { id: message.id },
    data: { parts: parts as unknown as Prisma.InputJsonValue },
  });

  return view;
}

/**
 * 用权威消息替换实体镜像，避免接受与后台消息写入竞争造成状态倒退。
 *
 * Overlay authoritative proposal states on entity-message mirrors when restoring history.
 */
export async function hydrateCodeProposals(
  database: Pick<Prisma.TransactionClient, 'agentCodeChangeProposal'>,
  userId: string,
  messages: unknown[],
): Promise<ReturnType<typeof normalizeChatMessage>[]> {
  const normalized = messages.map(normalizeChatMessage);
  const ids = normalized.flatMap((message) =>
    message.parts.flatMap((part) => (part.type === 'code_change' ? [part.proposal.id] : [])),
  );
  if (ids.length === 0) {
    return normalized;
  }

  const proposals = await database.agentCodeChangeProposal.findMany({
    where: { id: { in: ids }, userId },
  });
  const byId = new Map(proposals.map((proposal) => [proposal.id, codeProposalView(proposal)]));

  return normalized.map((message) => ({
    ...message,
    parts: message.parts.flatMap((part): MessagePart[] => {
      if (part.type !== 'code_change') {
        return [part];
      }
      const proposal = byId.get(part.proposal.id);

      return proposal ? [{ type: 'code_change', proposal }] : [];
    }),
  }));
}

/**
 * 从持久会话恢复助手产物，覆盖消息镜像尚未来得及写回的进程中断窗口。
 * 无会话的旧对象仍读取原消息镜像。
 *
 * Restore durable assistant artifacts even if a process stopped before mirroring them to the host.
 * Legacy hosts without a conversation continue reading their original message mirror.
 */
export async function readCodeProposalHistory(
  database: Pick<Prisma.TransactionClient, 'agentConversation' | 'agentCodeChangeProposal'>,
  userId: string,
  surface: CodeProposalContext['surface'],
  entityId: string,
  mirror: unknown[],
) {
  const conversation = await database.agentConversation.findFirst({
    where: {
      userId,
      surface,
      archivedAt: null,
      ...(surface === 'factor' ? { factorId: entityId } : { strategyId: entityId }),
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      messages: {
        orderBy: { sequence: 'asc' },
        select: {
          id: true,
          role: true,
          parts: true,
          turnId: true,
          sequence: true,
          createdAt: true,
        },
      },
    },
  });
  const messages = conversation
    ? conversation.messages.map((message) => ({
        ...message,
        createdAt: message.createdAt.toISOString(),
      }))
    : mirror;

  return hydrateCodeProposals(database, userId, messages);
}
