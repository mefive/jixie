import { prisma } from '../database/prisma.js';
import { appendLog, getLiveJobLogs, scheduleJobLogEviction } from './logs.js';
import type { JobKind } from './records.js';
import type {
  JobFailure,
  JobRegistry,
  PreparedJob,
  RegisteredJobDefinition,
} from './definition.js';

export interface JobExecutor {
  execute(jobId: string): Promise<void>;
  recoverInterruptedJobs(): Promise<number>;
}

export function createJobExecutor(registry: JobRegistry): JobExecutor {
  // Loading definitions has no execution side effects; cache only successful loads.
  let loadedDefinitions: RegisteredJobDefinition[] | undefined;
  async function definitions() {
    loadedDefinitions ??= await Promise.all(Object.values(registry).map((load) => load()));
    return loadedDefinitions;
  }

  async function fail(jobId: string, failure: JobFailure): Promise<boolean> {
    const registered = await definitions();
    const committed = await prisma.$transaction(async (transaction) => {
      const job = await transaction.job.findUnique({ where: { id: jobId } });
      if (!job || job.status !== 'running') {
        return false;
      }
      // Use persisted links even when kind or payload is corrupt.
      for (const definition of registered) {
        await definition.fail(transaction, [job], failure);
      }
      const logs = getLiveJobLogs(jobId);
      const { count } = await transaction.job.updateMany({
        where: { id: jobId, status: 'running' },
        data: {
          status: 'error',
          error: failure.message,
          finishedAt: new Date(),
          logs: logs ? JSON.stringify(logs) : undefined,
        },
      });
      if (count !== 1) {
        throw new Error('Job changed while committing failure');
      }
      return true;
    });
    if (committed) {
      scheduleJobLogEviction(jobId);
    }
    return committed;
  }

  async function afterCommit(
    prepared: PreparedJob | undefined,
    jobId: string,
    status: 'done' | 'error',
  ) {
    try {
      await prepared?.afterCommit(status);
    } catch (error) {
      // A notification/accounting failure cannot undo an already committed result.
      console.error('[jixie] job post-commit action failed', { jobId, status, error });
    }
  }

  return {
    async execute(jobId) {
      let prepared: PreparedJob | undefined;
      let phase: JobFailure['phase'] = 'input';
      try {
        const job = await prisma.job.findUnique({ where: { id: jobId } });
        if (!job || job.status !== 'running') {
          return;
        }
        if (!job.payload || typeof job.payload !== 'object' || Array.isArray(job.payload)) {
          throw new Error('Queued job payload is missing or invalid');
        }
        if (!Object.hasOwn(registry, job.kind)) {
          throw new Error(`Unsupported queued job kind: ${job.kind}`);
        }
        const definition = await registry[job.kind as JobKind]();
        prepared = definition.prepare({ job, log: (entry) => appendLog(jobId, entry) });
        phase = 'execution';
        const result = await prepared.execute();
        phase = 'completion';
        const committed = await prisma.$transaction(async (transaction) => {
          const current = await transaction.job.findUnique({ where: { id: jobId } });
          if (!current || current.status !== 'running') {
            return false;
          }
          await result.complete(transaction);
          const logs = getLiveJobLogs(jobId);
          const { count } = await transaction.job.updateMany({
            where: { id: jobId, status: 'running' },
            data: {
              status: 'done',
              error: null,
              finishedAt: new Date(),
              logs: logs ? JSON.stringify(logs) : undefined,
            },
          });
          if (count !== 1) {
            throw new Error('Job changed while committing completion');
          }
          return true;
        });
        if (committed) {
          scheduleJobLogEviction(jobId);
          await afterCommit(prepared, jobId, 'done');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Preserve both causes if failure persistence also fails.
        let failed: boolean;
        try {
          failed = await fail(jobId, { message, phase });
        } catch (failureError) {
          throw new AggregateError(
            [error, failureError],
            'Job execution and failure persistence failed',
          );
        }
        if (failed) {
          await afterCommit(prepared, jobId, 'error');
        }
      }
    },
    async recoverInterruptedJobs() {
      const registered = await definitions();
      return prisma.$transaction(async (transaction) => {
        const jobs = await transaction.job.findMany({ where: { status: 'running' } });
        if (jobs.length === 0) {
          return 0;
        }
        for (const definition of registered) {
          await definition.recover(transaction, jobs);
        }
        const { count } = await transaction.job.updateMany({
          where: { id: { in: jobs.map((job) => job.id) }, status: 'running' },
          data: { status: 'stale', finishedAt: new Date() },
        });
        return count;
      });
    },
  };
}
