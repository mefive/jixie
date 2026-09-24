import type { FactorCorrelationJobPayload } from './job-payload.js';
import { prisma } from '#infra/database/prisma.js';
import { JobScheduler } from '#jobs/scheduler.js';
import { JobService, ACTIVE_JOB_STATUSES } from '#jobs/service.js';
import type { FactorCorrelation, Locale } from '@jixie/shared';
import { BUILTIN_KEYS } from '../definitions/builtin-factors.js';
import { FactorError } from '../errors.js';
import { readOwnedFactorJob } from '../jobs/read.js';
import type {
  FactorCorrelationQuery,
  FactorJobLogsQuery,
  SubmitFactorCorrelationInput,
} from '@jixie/shared/api/factor';

const sortedKeys = (keys: string[]) => [...keys].sort();

const correlationId = (userId: string, keys: string[], freq: string, start: string, end: string) =>
  `${userId}|${sortedKeys(keys).join(',')}|${freq}|${start}|${end}`;

const correlationJobKey = (keys: string[], freq: string, start: string, end: string) =>
  `corr|${sortedKeys(keys).join(',')}|${freq}|${start}|${end}`;

async function resolveCorrelationKeys(userId: string, raw: string[]): Promise<{ keys: string[] }> {
  const keys = [...new Set(raw.map((key) => key.trim()).filter(Boolean))];

  if (keys.length < 2 || keys.length > 8) {
    throw new FactorError('correlation_key_count');
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
      throw new FactorError('unknown_factor', { params: { factor: key } });
    }
  }

  return { keys };
}

export async function readFactorCorrelation(userId: string, input: FactorCorrelationQuery) {
  const { keys, freq, start, end } = input;
  const resolved = await resolveCorrelationKeys(userId, keys);

  const cached = await prisma.factorCorrelation.findUnique({
    where: { id: correlationId(userId, resolved.keys, freq, start, end) },
  });

  if (!cached) {
    throw new FactorError('evaluation_not_found');
  }

  return JSON.parse(cached.payload) as FactorCorrelation;
}

export async function findActiveFactorCorrelationJob(
  userId: string,
  input: FactorCorrelationQuery,
) {
  const { keys, freq, start, end } = input;
  const resolved = await resolveCorrelationKeys(userId, keys);

  const jobId = await findActiveCorrelationJobId(
    userId,
    correlationJobKey(resolved.keys, freq, start, end),
  );

  return jobId ? { jobId } : null;
}

export async function submitFactorCorrelation(
  userId: string,
  input: SubmitFactorCorrelationInput,
  locale: Locale,
) {
  const { keys, freq, start, end, refresh } = input;
  const resolved = await resolveCorrelationKeys(userId, keys);

  if (start >= end) {
    throw new FactorError('start_after_end');
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

  const jobId = await JobService.create(
    userId,
    'factor-correlation',
    correlationJobKey(resolved.keys, freq, start, end),
    {
      id,
      userId,
      keys: resolved.keys,
      freq,
      start,
      end,
      locale: locale,
    } satisfies FactorCorrelationJobPayload,
  );

  JobScheduler.wake();

  return { jobId };
}

export async function readFactorCorrelationJob(
  userId: string,
  jobId: string,
  input: FactorJobLogsQuery,
) {
  const job = await readOwnedFactorJob(
    userId,
    jobId,
    'factor-correlation',
    Number(input.since ?? '0'),
  );

  if (!job) {
    throw new FactorError('factor_job_not_found');
  }

  return job;
}

async function findActiveCorrelationJobId(userId: string, key: string) {
  const job = await prisma.job.findFirst({
    where: {
      userId,
      kind: 'factor-correlation',
      key,
      factorReportId: null,
      status: { in: ACTIVE_JOB_STATUSES },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });

  return job?.id ?? null;
}
