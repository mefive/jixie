import { z } from 'zod';
import { defineJob } from '#infra/jobs/definition.js';
import { executeEmbeddedRun } from './execute.js';
import { completeEmbeddedRun, failEmbeddedRun } from './finish.js';

const payloadSchema = z.strictObject({ runId: z.string().min(1) });
export const researchEmbeddedAnalysisJob = defineJob({
  parse(raw, job) {
    const input = payloadSchema.parse(raw);
    if (input.runId !== job.researchExecutionId) {
      throw new Error('Embedded analysis payload does not match its persisted run');
    }
    return input;
  },
  async execute(context, input) {
    const startedAt = Date.now();
    context.log({
      source: 'system',
      level: 'info',
      text: `Running embedded analysis ${context.job.key}, run ${input.runId}`,
    });
    const output = await executeEmbeddedRun(input.runId, context.job.userId);
    context.log({
      source: 'system',
      level: output.status === 'success' ? 'info' : 'error',
      text: `Embedded run ${input.runId}: ${output.status} after ${Date.now() - startedAt} ms`,
    });
    return output;
  },
  async complete(transaction, job, input, output) {
    if (input.runId !== output.runId || output.runId !== job.researchExecutionId) {
      throw new Error('Embedded analysis completion does not match its job');
    }
    await completeEmbeddedRun(transaction, output);
  },
  async fail(transaction, jobs, failure) {
    for (const job of jobs) {
      if (job.researchExecutionId) {
        await failEmbeddedRun(
          transaction,
          job.researchExecutionId,
          'execution_failed',
          failure.message,
        );
      }
    }
  },
  async recover(transaction, jobs) {
    for (const job of jobs) {
      if (job.researchExecutionId) {
        await failEmbeddedRun(
          transaction,
          job.researchExecutionId,
          'interrupted',
          'API process stopped before execution completed',
          'cancelled',
        );
      }
    }
  },
});
