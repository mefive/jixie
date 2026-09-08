import { ulid } from 'ulid';
import { prisma } from '../../infra/database/prisma.js';
import { initializeJobLogs } from '../../infra/jobs/logs.js';
import { wakeJobQueue } from '../../infra/jobs/queue.js';
import { getResearchCuratorRun } from './runs.js';

export async function submitResearchCuratorRun(userId: string) {
  const active = await prisma.researchCuratorRun.findFirst({
    where: { userId, status: { in: ['queued', 'running'] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (active) {
    return (await getResearchCuratorRun(userId, active.id))!;
  }

  const previous = await prisma.researchCuratorRun.findFirst({
    where: { userId, status: 'done' },
    orderBy: { cursorTo: 'desc' },
    select: { cursorTo: true },
  });
  const runId = ulid();
  const jobId = ulid();
  const cursorTo = new Date();
  await prisma.$transaction([
    prisma.researchCuratorRun.create({
      data: {
        id: runId,
        userId,
        trigger: 'manual',
        cursorFrom: previous?.cursorTo,
        cursorTo,
      },
    }),
    prisma.job.create({
      data: {
        id: jobId,
        userId,
        kind: 'research-curator',
        key: 'default',
        status: 'queued',
        payload: { runId },
        researchCuratorRunId: runId,
      },
    }),
  ]);

  initializeJobLogs(jobId);
  wakeJobQueue();
  return (await getResearchCuratorRun(userId, runId))!;
}
