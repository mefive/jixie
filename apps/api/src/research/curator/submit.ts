import type { ResearchCuratorJobPayload } from './job-payload.js';
import { researchCuratorRunStatusWhere } from './state.js';
import { ulid } from 'ulid';
import { prisma } from '#infra/database/prisma.js';
import { JobScheduler } from '#jobs/scheduler.js';
import { getResearchCuratorRun } from './read.js';

export async function submitResearchCuratorRun(userId: string) {
  const submitted = await prisma.$transaction(async (transaction) => {
    const active = await transaction.researchCuratorRun.findFirst({
      where: { userId, AND: [researchCuratorRunStatusWhere(['queued', 'running'])] },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (active) {
      return { runId: active.id, created: false };
    }
    const previous = await transaction.researchCuratorRun.findFirst({
      where: { userId, AND: [researchCuratorRunStatusWhere(['done'])] },
      orderBy: { cursorTo: 'desc' },
      select: { cursorTo: true },
    });
    const runId = ulid();
    await transaction.researchCuratorRun.create({
      data: {
        id: runId,
        userId,
        legacyStatus: null,
        legacyError: null,
        trigger: 'manual',
        cursorFrom: previous?.cursorTo,
        cursorTo: new Date(),
        job: {
          create: {
            id: ulid(),
            userId,
            kind: 'research-curator',
            key: 'default',
            status: 'queued',
            payload: { runId } satisfies ResearchCuratorJobPayload,
          },
        },
      },
    });
    return { runId, created: true };
  });
  if (submitted.created) {
    JobScheduler.wake();
  }
  return getResearchCuratorRun(userId, submitted.runId);
}
