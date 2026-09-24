import { researchEmbeddedAnalysisJobPayloadSchema } from './job-payload.js';
import type { JobLifecycle } from '#jobs/lifecycle.js';
import { executeEmbeddedRun } from './execute.js';
import { completeEmbeddedRun, failEmbeddedRun } from './finish.js';

export const researchEmbeddedAnalysisLifecycle = {
  async onExecute(job, log) {
    const input = researchEmbeddedAnalysisJobPayloadSchema.parse(job.payload);
    if (input.runId !== job.researchExecutionId) {
      throw new Error('Embedded analysis payload does not match its persisted run');
    }
    const startedAt = Date.now();
    log({
      source: 'system',
      level: 'info',
      text: `Running embedded analysis ${job.key}, run ${input.runId}`,
    });
    const output = await executeEmbeddedRun(input.runId, job.userId);
    log({
      source: 'system',
      level: output.status === 'success' ? 'info' : 'error',
      text: `Embedded run ${input.runId}: ${output.status} after ${Date.now() - startedAt} ms`,
    });

    return output;
  },
  async onSuccess(transaction, job, output) {
    if (output.runId !== job.researchExecutionId) {
      throw new Error('Embedded analysis completion does not match its job');
    }
    await completeEmbeddedRun(transaction, output);
  },
  async onFailure(transaction, job, error) {
    if (job.researchExecutionId) {
      await failEmbeddedRun(
        transaction,
        job.researchExecutionId,
        'execution_failed',
        error instanceof Error ? error.message : String(error),
      );
    }
  },
  async onInterrupted(transaction, job) {
    if (job.researchExecutionId) {
      await failEmbeddedRun(
        transaction,
        job.researchExecutionId,
        'interrupted',
        'API process stopped before execution completed',
        'cancelled',
      );
    }
  },
} satisfies JobLifecycle<Awaited<ReturnType<typeof executeEmbeddedRun>>>;
