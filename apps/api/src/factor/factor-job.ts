import type { RegisteredJobDefinition } from '../infra/jobs/definition.js';
import { factorAnalysisJob } from './analysis-job.js';
import { factorCorrelationJob } from './correlation-job.js';

// Keep the persisted kind/task format. Factor owns this legacy task discriminator.
export const factorJob: RegisteredJobDefinition = {
  prepare(context) {
    const payload = context.job.payload;
    const correlation =
      payload &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      payload.task === 'correlation';
    return (correlation ? factorCorrelationJob : factorAnalysisJob).prepare(context);
  },
  async fail(transaction, jobs, failure) {
    await factorAnalysisJob.fail(transaction, jobs, failure);
    await factorCorrelationJob.fail(transaction, jobs, failure);
  },
  async recover(transaction, jobs) {
    await factorAnalysisJob.recover(transaction, jobs);
    await factorCorrelationJob.recover(transaction, jobs);
  },
};
