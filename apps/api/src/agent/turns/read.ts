import { prisma } from '#infra/database/prisma.js';
import type { AgentTurnDetail } from '@jixie/shared';
import { AgentError } from '../errors.js';

/**
 * 验证轮次访问归属后返回输入、轨迹与持久化终态。
 *
 * Authorize a turn and return its input, trace and persisted state.
 */
export async function getTurnDetail(userId: string, turnId: string) {
  const row = await prisma.agentTurn.findFirst({
    where: { id: turnId, conversation: { userId: userId } },
  });
  if (!row) {
    throw new AgentError('turn_not_found');
  }
  return {
    id: row.id,
    status: row.status as AgentTurnDetail['status'],
    model: row.model,
    trace: row.trace as unknown as AgentTurnDetail['trace'],
    error: row.error ?? undefined,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString(),
    ...(row.contextSnapshot
      ? { contextSnapshot: row.contextSnapshot as unknown as AgentTurnDetail['contextSnapshot'] }
      : {}),
  } satisfies AgentTurnDetail;
}
