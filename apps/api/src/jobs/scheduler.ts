import { prisma } from '#infra/database/prisma.js';
import { JobService } from './service.js';

interface QueueCandidate {
  id: string;
  userId: string;
}
export interface JobQueueConfig {
  concurrency: number;
  perUserConcurrency: number;
}

export function loadJobQueueConfig(env: NodeJS.ProcessEnv = process.env): JobQueueConfig {
  return {
    concurrency: positiveInteger(env.JIXIE_JOB_CONCURRENCY, 2),
    perUserConcurrency: positiveInteger(env.JIXIE_JOB_PER_USER_CONCURRENCY, 1),
  };
}

export class JobScheduler {
  private static instance: JobScheduler | undefined;

  public static initialize(
    execute: (jobId: string) => Promise<void>,
    config: JobQueueConfig = loadJobQueueConfig(),
  ): void {
    if (JobScheduler.instance) {
      throw new Error('JobScheduler is already initialized');
    }
    JobScheduler.instance = new JobScheduler(execute, config);
  }

  public static wake(): void {
    JobScheduler.instance?.requestDispatch();
  }

  private readonly activeJobs = new Map<string, string>();
  private dispatchLoopActive = false;
  private dispatchRequested = false;

  private constructor(
    private readonly execute: (jobId: string) => Promise<void>,
    private readonly config: JobQueueConfig,
  ) {}

  private requestDispatch(): void {
    this.dispatchRequested = true;
    if (this.dispatchLoopActive) {
      return;
    }
    this.dispatchLoopActive = true;
    queueMicrotask(() => {
      void this.dispatchLoop();
    });
  }

  private async dispatchLoop() {
    try {
      while (this.dispatchRequested) {
        this.dispatchRequested = false;
        try {
          await this.dispatchQueuedJobs();
        } catch (error) {
          console.error('[jixie] job dispatch failed', error);
        }
      }
    } finally {
      this.dispatchLoopActive = false;
    }
  }

  private async dispatchQueuedJobs() {
    while (this.activeJobs.size < this.config.concurrency) {
      const counts = new Map<string, number>();
      for (const userId of this.activeJobs.values()) {
        counts.set(userId, (counts.get(userId) ?? 0) + 1);
      }
      const saturated = [...counts]
        .filter(([, count]) => count >= this.config.perUserConcurrency)
        .map(([userId]) => userId);
      const candidate = await prisma.job.findFirst({
        where: { status: 'queued', userId: { notIn: saturated } },
        orderBy: [{ queuedAt: 'asc' }, { id: 'asc' }],
        select: { id: true, userId: true },
      });
      if (!candidate) {
        return;
      }
      if (!(await JobService.claim(candidate.id))) {
        continue;
      }
      this.activeJobs.set(candidate.id, candidate.userId);
      void this.executeClaimed(candidate);
    }
  }

  private async executeClaimed(candidate: QueueCandidate) {
    try {
      await this.execute(candidate.id);
    } catch (error) {
      console.error('[jixie] failed to execute or finalize queued job', {
        jobId: candidate.id,
        error,
      });
    } finally {
      this.activeJobs.delete(candidate.id);
      this.requestDispatch();
    }
  }
}

function positiveInteger(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
