import { z } from 'zod';
import type { FactorCorrelation } from '@jixie/shared';
import { prisma } from '#infra/database/prisma.js';
import { BUILTIN_KEYS } from '../definitions/builtin-factors.js';
import { createJob, findRunningJob } from '#infra/jobs/records.js';
import { wakeJobQueue } from '#infra/jobs/queue.js';
import { t } from '#i18n/index.js';
import type { Locale } from '@jixie/shared';
import { failFactorOperation } from '../operation-errors.js';

const sortedKeys = (keys: string[]) => [...keys].sort();

const correlationId = (userId: string, keys: string[], freq: string, start: string, end: string) =>
  `${userId}|${sortedKeys(keys).join(',')}|${freq}|${start}|${end}`;

const correlationJobKey = (keys: string[], freq: string, start: string, end: string) =>
  `corr|${sortedKeys(keys).join(',')}|${freq}|${start}|${end}`;

export const factorCorrelationQuerySchema = z.object({
  keys: z.string().min(1), // comma-separated factor keys
  freq: z.enum(['month', 'week']).default('month'),
  start: z
    .string()
    .regex(/^\d{8}$/)
    .default('20150101'),
  end: z
    .string()
    .regex(/^\d{8}$/)
    .default('20261231'),
  refresh: z.string().optional(),
});

async function resolveCorrelationKeys(
  userId: string,
  raw: string,
): Promise<{ keys: string[] } | { error: string }> {
  const keys = [
    ...new Set(
      raw
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
    ),
  ];

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

export async function findFactorCorrelationJob(
  userId: string,
  input: z.infer<typeof factorCorrelationQuerySchema>,
) {
  const { keys, freq, start, end } = input;
  const resolved = await resolveCorrelationKeys(userId, keys);

  if ('error' in resolved) {
    return { jobId: null };
  }

  const jobId = await findRunningJob(
    userId,
    'factor',
    correlationJobKey(resolved.keys, freq, start, end),
  );

  return { jobId };
}

export async function submitFactorCorrelation(
  userId: string,
  input: z.infer<typeof factorCorrelationQuerySchema>,
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

  if (refresh !== '1') {
    const cached = await prisma.factorCorrelation.findUnique({ where: { id } });
    if (cached) {
      return { done: true, report: JSON.parse(cached.payload) as FactorCorrelation };
    }
  }

  const existing = await findRunningJob(
    userId,
    'factor',
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
