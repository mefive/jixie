import { Worker } from 'node:worker_threads';
import { Hono } from 'hono';
import { z } from 'zod';
import { ulid } from 'ulid';
import type { BacktestConfig, BacktestSummary } from '@jixie/shared';
import { apiError, validateJson, validateQuery } from '../lib/httpError.js';
import { configSchema } from '../strategy/ir/schema.js';

/**
 * Backtest API. A backtest is CPU-heavy (tens of seconds to minutes) and would block the HTTP event
 * loop, so each run executes in a worker_threads Worker (see engine/backtest-worker.ts): POST queues
 * a job + spawns the worker and returns a jobId immediately; the worker streams progress log lines
 * back, which the job accumulates; GET /:jobId?since=N reports status + the logs after cursor N (so
 * the frontend can poll and append) and the result once done.
 *
 * MVP scope: jobs live in an in-memory map (single process, not persisted) and one worker is spawned
 * per run. Persisting jobs + a worker pool is a later step.
 */

type Job = {
  status: 'running' | 'done' | 'error';
  logs: string[];
  result?: BacktestSummary;
  message?: string;
};

type WorkerMsg =
  | { type: 'log'; line: string }
  | { type: 'done'; result: BacktestSummary }
  | { type: 'error'; message: string };

const jobs = new Map<string, Job>();
const JOB_TTL_MS = 30 * 60_000; // forget finished jobs after 30 min to bound memory

// Pick the worker entry for how we're running. Dev (tsx): worker threads don't inherit tsx's TS
// loader, so we spawn a plain .mjs bootstrap that registers tsx then imports the .ts worker. Prod
// (tsc build): spawn the compiled .js directly.
const workerUrl = import.meta.url.endsWith('.ts')
  ? new URL('../engine/backtest-worker.boot.mjs', import.meta.url)
  : new URL('../engine/backtest-worker.js', import.meta.url);

export const backtestRoute = new Hono();

// === POST /api/app/backtest === queue a run in a worker, return { jobId }
backtestRoute.post('/', validateJson(configSchema), (c) => {
  const config = c.req.valid('json') as BacktestConfig;
  if (config.start >= config.end) {
    return apiError(c, 'VALIDATION_FAILED', '起始日期必须早于结束日期', { field: 'start' });
  }

  const jobId = ulid();
  const job: Job = { status: 'running', logs: [] };
  jobs.set(jobId, job);

  const worker = new Worker(workerUrl, { workerData: { config } });
  worker.on('message', (msg: WorkerMsg) => {
    if (msg.type === 'log') job.logs.push(msg.line);
    else if (msg.type === 'done') {
      job.status = 'done';
      job.result = msg.result;
    } else if (msg.type === 'error') {
      job.status = 'error';
      job.message = msg.message;
    }
  });
  worker.on('error', (err) => {
    job.status = 'error';
    job.message = err.message;
  });
  worker.on('exit', (code) => {
    // A non-zero exit while still "running" means the worker died before reporting (crash / OOM).
    if (job.status === 'running') {
      job.status = 'error';
      job.message = `回测进程异常退出 (code ${code})`;
    }
    setTimeout(() => jobs.delete(jobId), JOB_TTL_MS).unref?.();
  });

  return c.json({ jobId });
});

// === GET /api/app/backtest/:jobId?since=N === poll status + incremental logs + result
const sinceQuery = z.object({ since: z.string().regex(/^\d+$/).optional() });

backtestRoute.get('/:jobId', validateQuery(sinceQuery), (c) => {
  const job = jobs.get(c.req.param('jobId'));
  if (!job) return apiError(c, 'NOT_FOUND', '回测任务不存在或已过期');

  const since = Number(c.req.valid('query').since ?? '0');
  const base = { status: job.status, logs: job.logs.slice(since), nextSince: job.logs.length };
  if (job.status === 'done') return c.json({ ...base, result: job.result });
  if (job.status === 'error') return c.json({ ...base, message: job.message });
  return c.json(base);
});
