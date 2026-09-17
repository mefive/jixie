import { prisma } from '#infra/database/prisma.js';
import { scheduleJobLogEviction } from '#infra/jobs/logs.js';
import { wakeJobQueue } from '#infra/jobs/queue.js';
import { ResearchError } from '../errors.js';
import { abortEmbeddedRuntime } from './execute.js';
import { failEmbeddedRun } from './finish.js';

import { runSummaryView } from './views.js';

export async function cancelEmbeddedRun(userId: string, analysisId: string, runId: string) {
  const result = await prisma.$transaction(async (transaction) => {
    const run = await transaction.researchExecution.findFirst({
      where: { id: runId, embeddedVersion: { analysisId, analysis: { userId } } },
      include: { job: true, embeddedVersion: true },
    });
    if (!run?.job) {
      throw new ResearchError('embedded_not_found');
    }
    if (run.status !== 'queued' && run.status !== 'running') {
      return { run: runSummaryView(run), cancelled: false };
    }
    await failEmbeddedRun(
      transaction,
      runId,
      'cancelled',
      'Execution cancelled by the user',
      'cancelled',
    );
    await transaction.job.updateMany({
      where: { id: run.job.id, status: { in: ['queued', 'running'] } },
      data: { status: 'error', error: 'Execution cancelled by the user', finishedAt: new Date() },
    });
    const updated = await transaction.researchExecution.findUniqueOrThrow({
      where: { id: runId },
      include: { job: true, embeddedVersion: true },
    });
    return { run: runSummaryView(updated), cancelled: true };
  });
  if (result.cancelled) {
    abortEmbeddedRuntime(runId);
    scheduleJobLogEviction(result.run.jobId);
    wakeJobQueue();
  }
  return result.run;
}
