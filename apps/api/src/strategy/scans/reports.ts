import type {
  BacktestConfig,
  StrategyScanPayload,
  StrategyScanReport,
  StrategyScanReportSummary,
  StrategyScanSpec,
} from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { ACTIVE_JOB_STATUSES, getJob } from '#infra/jobs/records.js';
import { prisma } from '#infra/database/prisma.js';
import type { scanStrategyQuerySchema, scanJobQuerySchema } from './inputs.js';
import { t } from '#i18n/index.js';
import type { Locale } from '@jixie/shared';
import { failStrategyOperation } from '../operation-errors.js';

export async function listStrategyScanReports(
  userId: string,
  query: z.infer<typeof scanStrategyQuerySchema>,
) {
  const rows = await prisma.strategyScanReport.findMany({
    where: { userId: userId, strategyId: query.strategyId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return rows.map(scanReportSummary);
}

export async function findStrategyScanJob(
  userId: string,
  query: z.infer<typeof scanStrategyQuerySchema>,
) {
  const row = await prisma.strategyScanReport.findFirst({
    where: {
      userId: userId,
      strategyId: query.strategyId,
      status: 'running',
      job: { status: { in: ACTIVE_JOB_STATUSES } },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, job: { select: { id: true } } },
  });

  return { reportId: row?.id ?? null, jobId: row?.job?.id ?? null };
}

export async function readStrategyScanJob(
  userId: string,
  reportId: string,
  query: z.infer<typeof scanJobQuerySchema>,
  locale: Locale,
) {
  const report = await prisma.strategyScanReport.findFirst({
    where: { id: reportId, userId: userId },
    select: { job: { select: { id: true } } },
  });

  if (!report?.job) {
    return failStrategyOperation('missing', t(locale, 'strategyScanJobNotFound'));
  }

  const job = await getJob(userId, report.job.id, Number(query.since ?? '0'));

  if (!job) {
    return failStrategyOperation('missing', t(locale, 'strategyScanJobNotFound'));
  }

  return job;
}

export async function readStrategyScanReport(userId: string, reportId: string, locale: Locale) {
  const row = await prisma.strategyScanReport.findFirst({
    where: { id: reportId, userId: userId },
    include: { job: { select: { id: true } } },
  });

  if (!row?.job) {
    return failStrategyOperation('missing', t(locale, 'strategyScanNotFound'));
  }

  return scanReportDetail(row);
}

function scanReportSummary(row: {
  id: string;
  strategyId: string;
  strategyName: string;
  status: string;
  spec: Prisma.JsonValue;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}): StrategyScanReportSummary {
  return {
    id: row.id,
    strategyId: row.strategyId,
    strategyName: row.strategyName,
    status: row.status as StrategyScanReportSummary['status'],
    spec: row.spec as unknown as StrategyScanSpec,
    error: row.error ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function scanReportDetail(row: {
  id: string;
  strategyId: string;
  strategyName: string;
  status: string;
  config: Prisma.JsonValue;
  spec: Prisma.JsonValue;
  codeHash: string;
  dataCutoff: string | null;
  payload: Prisma.JsonValue | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  job: { id: string } | null;
}): StrategyScanReport {
  return {
    id: row.id,
    strategyId: row.strategyId,
    strategyName: row.strategyName,
    status: row.status as StrategyScanReport['status'],
    config: row.config as unknown as BacktestConfig,
    spec: row.spec as unknown as StrategyScanSpec,
    codeHash: row.codeHash,
    dataCutoff: row.dataCutoff,
    payload: (row.payload as unknown as StrategyScanPayload) ?? undefined,
    error: row.error ?? undefined,
    jobId: row.job!.id,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
