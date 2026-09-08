import type { JobStatus } from './records.js';
import type { JobExecutor } from './executor.js';
import { claimQueuedJob } from './records.js';
import { initializeJobLogs } from './logs.js';
import { prisma } from '../database/prisma.js';

export interface QueueCandidate {
  id: string;
  userId: string;
}

export interface JobQueueConfig {
  concurrency: number;
  perUserConcurrency: number;
}

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_PER_USER_CONCURRENCY = 1;
const activeJobs = new Map<string, string>();
let draining = false;
let wakePending = false;
let rerunRequested = false;
let started = false;

let executor: Pick<JobExecutor, 'execute'>;

export function loadJobQueueConfig(env: NodeJS.ProcessEnv = process.env): JobQueueConfig {
  return {
    concurrency: positiveInteger(env.JIXIE_JOB_CONCURRENCY, DEFAULT_CONCURRENCY),
    perUserConcurrency: positiveInteger(
      env.JIXIE_JOB_PER_USER_CONCURRENCY,
      DEFAULT_PER_USER_CONCURRENCY,
    ),
  };
}

/** Pick FIFO jobs while enforcing a per-user slot cap. Candidates must already be oldest first. */
export function selectFairQueuedJobs(
  candidates: QueueCandidate[],
  activeUserCounts: ReadonlyMap<string, number>,
  availableSlots: number,
  perUserConcurrency: number,
): QueueCandidate[] {
  const selected: QueueCandidate[] = [];
  const counts = new Map(activeUserCounts);
  for (const candidate of candidates) {
    if (selected.length >= availableSlots) {
      break;
    }
    const active = counts.get(candidate.userId) ?? 0;
    if (active >= perUserConcurrency) {
      continue;
    }
    selected.push(candidate);
    counts.set(candidate.userId, active + 1);
  }
  return selected;
}

/** Start scheduling queued jobs, including durable jobs left queued by a previous API process. */
export function startJobQueue(jobExecutor: Pick<JobExecutor, 'execute'>): void {
  executor = jobExecutor;
  started = true;
  wakeJobQueue();
}

/** Notify the process-local scheduler after a queued Job transaction commits. */
export function wakeJobQueue(): void {
  if (!started) {
    return;
  }
  if (draining) {
    rerunRequested = true;
    return;
  }
  if (wakePending) {
    return;
  }
  wakePending = true;
  queueMicrotask(() => {
    wakePending = false;
    void drainQueue();
  });
}

/** Wait for a durable Job to become terminal; signal maintenance uses this after enqueueing. */
export async function waitForJobCompletion(
  jobId: string,
): Promise<Extract<JobStatus, 'done' | 'error' | 'stale'>> {
  for (;;) {
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true } });
    if (!job || job.status === 'error' || job.status === 'stale') {
      return job?.status === 'stale' ? 'stale' : 'error';
    }
    if (job.status === 'done') {
      return 'done';
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function drainQueue(): Promise<void> {
  if (draining) {
    return;
  }
  draining = true;
  try {
    const config = loadJobQueueConfig();
    const availableSlots = config.concurrency - activeJobs.size;
    if (availableSlots <= 0) {
      return;
    }
    const candidates = await prisma.job.findMany({
      where: { status: 'queued' },
      orderBy: [{ queuedAt: 'asc' }, { id: 'asc' }],
      take: 200,
      select: { id: true, userId: true },
    });
    const activeUserCounts = new Map<string, number>();
    for (const userId of activeJobs.values()) {
      activeUserCounts.set(userId, (activeUserCounts.get(userId) ?? 0) + 1);
    }
    const selected = selectFairQueuedJobs(
      candidates,
      activeUserCounts,
      availableSlots,
      config.perUserConcurrency,
    );
    for (const candidate of selected) {
      if (!(await claimQueuedJob(candidate.id))) {
        continue;
      }
      initializeJobLogs(candidate.id);
      activeJobs.set(candidate.id, candidate.userId);
      void executeClaimedJob(candidate.id).finally(() => {
        activeJobs.delete(candidate.id);
        wakeJobQueue();
      });
    }
  } finally {
    draining = false;
    if (rerunRequested) {
      rerunRequested = false;
      wakeJobQueue();
    }
  }
}

async function executeClaimedJob(jobId: string): Promise<void> {
  try {
    await executor.execute(jobId);
  } catch (error) {
    console.error('[jixie] failed to execute or finalize queued job', { jobId, error });
  }
}

function positiveInteger(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
