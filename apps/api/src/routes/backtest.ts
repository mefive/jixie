import { Hono } from 'hono';
import { z } from 'zod';
import { ulid } from 'ulid';
import type { BacktestConfig, BacktestSummary } from '@jixie/shared';
import { apiError, validateJson } from '../lib/httpError.js';
import { runBacktestConfig } from '../strategy/ir/interpret.js';

/**
 * Backtest API. A backtest is CPU-heavy (tens of seconds to minutes), too long for a synchronous
 * HTTP request, so we use the "submit → poll" pattern (per CLAUDE.md): POST queues a job and returns
 * a jobId immediately; GET /:jobId reports running/done/error and returns the result when done.
 *
 * MVP scope: jobs live in an in-memory map (single process, not persisted). Phase 2 moves the run to
 * a worker thread + a DB-backed job table so the HTTP thread never blocks on compute.
 */

type Job =
  | { status: 'running' }
  | { status: 'done'; result: BacktestSummary }
  | { status: 'error'; message: string };

const jobs = new Map<string, Job>();
const JOB_TTL_MS = 30 * 60_000; // forget finished jobs after 30 min to bound memory

// —— IR validation (zod mirror of @jixie/shared IR types) ——

const exprSchema: z.ZodType = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('const'), value: z.number() }),
    z.object({ kind: z.literal('field'), name: z.string().min(1) }),
    z.object({ kind: z.literal('factor'), name: z.string().min(1) }),
    z.object({ kind: z.literal('unary'), op: z.enum(['neg', 'abs', 'ln']), arg: exprSchema }),
    z.object({
      kind: z.literal('binary'),
      op: z.enum(['+', '-', '*', '/']),
      left: exprSchema,
      right: exprSchema,
    }),
  ]),
);

const universeFilterSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('minListDays'), days: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('dropIlliquidPct'), pct: z.number().min(0).max(100) }),
  z.object({
    kind: z.literal('field'),
    field: z.string().min(1),
    op: z.enum(['>', '>=', '<', '<=']),
    value: z.number(),
  }),
]);

const crossSectionSchema = z.object({
  type: z.literal('cross_section'),
  schedule: z.enum(['daily', 'weekly', 'monthly']),
  universe: z.object({ filters: z.array(universeFilterSchema) }),
  score: exprSchema,
  factors: z.array(z.string()).optional(),
  pick: z.object({ side: z.enum(['high', 'low']), quantile: z.number().gt(0).max(1) }),
  weight: z.literal('equal'),
});

const configSchema = z.object({
  name: z.string().min(1).max(100),
  start: z.string().regex(/^\d{8}$/),
  end: z.string().regex(/^\d{8}$/),
  initialCash: z.number().positive(),
  cost: z
    .object({
      commission: z.number().min(0).optional(),
      minCommission: z.number().min(0).optional(),
      stampDuty: z.number().min(0).optional(),
      transferFee: z.number().min(0).optional(),
    })
    .optional(),
  strategy: crossSectionSchema,
});

export const backtestRoute = new Hono();

// === POST /api/app/backtest === queue a run, return { jobId }
backtestRoute.post('/', validateJson(configSchema), (c) => {
  const config = c.req.valid('json') as BacktestConfig;
  if (config.start >= config.end) {
    return apiError(c, 'VALIDATION_FAILED', '起始日期必须早于结束日期', { field: 'start' });
  }

  const jobId = ulid();
  jobs.set(jobId, { status: 'running' });

  // Run detached. The route returns immediately; the frontend polls GET /:jobId.
  void runBacktestConfig(config)
    .then((r) => {
      jobs.set(jobId, { status: 'done', result: { ...r } });
    })
    .catch((e: unknown) => {
      jobs.set(jobId, { status: 'error', message: e instanceof Error ? e.message : String(e) });
    })
    .finally(() => {
      setTimeout(() => jobs.delete(jobId), JOB_TTL_MS).unref?.();
    });

  return c.json({ jobId });
});

// === GET /api/app/backtest/:jobId === poll status / fetch result
backtestRoute.get('/:jobId', (c) => {
  const job = jobs.get(c.req.param('jobId'));
  if (!job) return apiError(c, 'NOT_FOUND', '回测任务不存在或已过期');
  return c.json(job);
});
