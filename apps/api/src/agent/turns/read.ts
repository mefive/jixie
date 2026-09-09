import type { AgentTurnDetail } from '@jixie/shared';
import { prisma } from '../../infra/database/prisma.js';

export async function getTurnDetail(userId: string, turnId: string) {
  const row = await prisma.agentTurn.findFirst({
    where: { id: turnId, conversation: { userId: userId } },
  });
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    status: row.status as AgentTurnDetail['status'],
    model: row.model,
    trace: row.trace as unknown as AgentTurnDetail['trace'],
    error: row.error ?? undefined,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString(),
  } satisfies AgentTurnDetail;
}
