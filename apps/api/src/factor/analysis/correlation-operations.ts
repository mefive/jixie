import { z } from 'zod';
import type { FactorCorrelation } from '@jixie/shared';
import { prisma } from '#infra/database/prisma.js';
import { BUILTIN_KEYS } from '../definitions/builtin-factors.js';
import { createJob, ACTIVE_JOB_STATUSES } from '#infra/jobs/records.js';
import { wakeJobQueue } from '#infra/jobs/queue.js';
import { t } from '#i18n/index.js';
import type { Locale } from '@jixie/shared';
import { failFactorOperation } from '../operation-errors.js';
import {
  matchesFactorJobTask,
  readOwnedFactorJob,
  type factorJobLogsQuerySchema,
} from './job-queries.js';

const sortedKeys = (keys: string[]) => [...keys].sort();

const correlationId = (userId: string, keys: string[], freq: string, start: string, end: string) =>
  `${userId}|${sortedKeys(keys).join(',')}|${freq}|${start}|${end}`;

const correlationJobKey = (keys: string[], freq: string, start: string, end: string) =>
  `corr|${sortedKeys(keys).join(',')}|${freq}|${start}|${end}`;

export const factorCorrelationQuerySchema = z.object({
  keys: z
    .string()
    .min(1)
    .transform((value) => value.split(',')),
  freq: z.enum(['month', 'week']).default('month'),
  start: z
    .string()
    .regex(/^\d{8}$/)
    .default('20150101'),
  end: z
    .string()
    .regex(/^\d{8}$/)
    .default('20261231'),
});

export const submitFactorCorrelationSchema = factorCorrelationQuerySchema.extend({
  keys: z.array(z.string()).min(1),
  refresh: z.boolean().default(false),
});

async function resolveCorrelationKeys(
  userId: string,
  raw: string[],
): Promise<{ keys: string[] } | { error: string }> {
  const keys = [...new Set(raw.map((key) => key.trim()).filter(Boolean))];

  if (keys.length < 2 || keys.length > 8) {
    return { error: 'correlationKeyCount' };
  }

  for (const key of keys) {
    if (BUILTIN_KEYS.has(key)) {
      continue;
    }
    const custom = await prisma.factor.findFirst({
      where: { id: key, userId },
      select: { id: true },
    });
    if (!custom) {
      return { error: key };
    }
  }

  return { keys };
}

export async function readFactorCorrelation(
  userId: string,
  input: z.infer<typeof factorCorrelationQuerySchema>,
  locale: Locale,
) {
  const { keys, freq, start, end } = input;
  const resolved = await resolveCorrelationKeys(userId, keys);

  if ('error' in resolved) {
    return failFactorOperation('invalid', t(locale, 'windowNotComputed'));
  }

  const cached = await prisma.factorCorrelation.findUnique({
    where: { id: correlationId(userId, resolved.keys, freq, start, end) },
  });

  if (!cached) {
    return failFactorOperation('missing', t(locale, 'windowNotComputed'));
  }

  return JSON.parse(cached.payload) as FactorCorrelation;
}

export async function findActiveFactorCorrelationJob(
  userId: string,
  input: z.infer<typeof factorCorrelationQuerySchema>,
) {
  const { keys, freq, start, end } = input;
  const resolved = await resolveCorrelationKeys(userId, keys);

  if ('error' in resolved) {
    return null;
  }

  const jobId = await findActiveCorrelationJobId(
    userId,
    correlationJobKey(resolved.keys, freq, start, end),
  );

  return jobId ? { jobId } : null;
}

export async function submitFactorCorrelation(
  userId: string,
  input: z.infer<typeof submitFactorCorrelationSchema>,
  locale: Locale,
) {
  const { keys, freq, start, end, refresh } = input;
  const resolved = await resolveCorrelationKeys(userId, keys);

  if ('error' in resolved) {
    return failFactorOperation('invalid', t(locale, 'unknownFactor', { factor: resolved.error }));
  }

  if (start >= end) {
    return failFactorOperation('invalid', t(locale, 'startAfterEnd'));
  }

  const id = correlationId(userId, resolved.keys, freq, start, end);

  if (!refresh) {
    const cached = await prisma.factorCorrelation.findUnique({ where: { id } });
    if (cached) {
      return { done: true, report: JSON.parse(cached.payload) as FactorCorrelation };
    }
  }

  const existing = await findActiveCorrelationJobId(
    userId,
    correlationJobKey(resolved.keys, freq, start, end),
  );

  if (existing) {
    return { jobId: existing };
  }

  const jobId = await createJob(
    userId,
    'factor',
    correlationJobKey(resolved.keys, freq, start, end),
    {
      task: 'correlation',
      id,
      userId,
      keys: resolved.keys,
      freq,
      start,
      end,
      locale: locale,
    },
  );

  wakeJobQueue();

  return { jobId };
}

export async function readFactorCorrelationJob(
  userId: string,
  jobId: string,
  input: z.infer<typeof factorJobLogsQuerySchema>,
  locale: Locale,
) {
  const job = await readOwnedFactorJob(userId, jobId, 'correlation', Number(input.since ?? '0'));

  if (!job) {
    return failFactorOperation('missing', t(locale, 'factorJobNotFound'));
  }

  return job;
}

async function findActiveCorrelationJobId(userId: string, key: string) {
  const job = await prisma.job.findFirst({
    where: { userId, kind: 'factor', key, status: { in: ACTIVE_JOB_STATUSES } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, payload: true, factorReportId: true },
  });

  return job && matchesFactorJobTask(job, 'correlation') ? job.id : null;
}
