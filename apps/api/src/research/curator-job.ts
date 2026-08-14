import { z } from 'zod';
import { appendLog, finishJob } from '../lib/jobs.js';
import { prisma } from '../lib/prisma.js';
import { executeResearchCuratorRun } from './curator.js';

const payloadSchema = z.strictObject({ runId: z.string().min(1) });

/** Execute one owner-scoped Curator pass inside the shared durable job scheduler. */
export async function runResearchCuratorJob(
  jobId: string,
  rawPayload: Record<string, unknown>,
): Promise<void> {
  const payload = payloadSchema.parse(rawPayload);
  appendLog(jobId, {
    source: 'system',
    level: 'info',
    text: 'Extracting owner-scoped research evidence.',
  });
  try {
    const result = await executeResearchCuratorRun(payload.runId);
    appendLog(jobId, {
      source: 'system',
      level: 'info',
      text: `Curator completed with ${result.findingsCreated} new finding(s).`,
    });
    await finishJob(jobId, 'done');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.researchCuratorRun.updateMany({
      where: { id: payload.runId, status: { in: ['queued', 'running'] } },
      data: { status: 'error', error: message },
    });
    await finishJob(jobId, 'error', message);
  }
}
