import { prisma } from '#infra/database/prisma.js';
import type { AgentTurnDetail } from '@jixie/shared';
import { AgentError } from '../errors.js';

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
