import { strategyScanReportState, strategyScanReportStatusWhere } from '#strategy/scans/state.js';
import { prisma } from '#infra/database/prisma.js';
import { JobService, ACTIVE_JOB_STATUSES } from '#jobs/service.js';
import type {
  BacktestConfig,
  StrategyScanPayload,
  StrategyScanReport,
  StrategyScanReportSummary,
  StrategyScanSpec,
} from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import { StrategyError } from '../errors.js';
import type { StrategyScanIdentityQuery, StrategyScanJobQuery } from '@jixie/shared/api/strategy';

export async function listStrategyScanReports(userId: string, query: StrategyScanIdentityQuery) {
  const rows = await prisma.strategyScanReport
    .findMany({
      include: { job: true },
      where: { userId: userId, strategyId: query.strategyId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    .then((rows) => rows.map(strategyScanReportState));

  return rows.map(scanReportSummary);
}

export async function findActiveStrategyScanJob(userId: string, query: StrategyScanIdentityQuery) {
  const row = await prisma.strategyScanReport.findFirst({
    where: {
      userId: userId,
      strategyId: query.strategyId,
      AND: [strategyScanReportStatusWhere(['running'])],
      job: { userId, kind: 'strategy-scan', status: { in: ACTIVE_JOB_STATUSES } },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, job: { select: { id: true } } },
  });

  return row?.job ? { jobId: row.job.id, reportId: row.id } : null;
}

export async function readStrategyScanJob(
  userId: string,
  jobId: string,
  query: StrategyScanJobQuery,
) {
  const ownedJob = await prisma.job.findFirst({
    where: { id: jobId, userId, kind: 'strategy-scan' },
    select: { id: true },
  });

  if (!ownedJob) {
    throw new StrategyError('strategy_scan_job_not_found');
  }

  const job = await JobService.get(userId, ownedJob.id, Number(query.since ?? '0'));

  if (!job) {
    throw new StrategyError('strategy_scan_job_not_found');
  }

  return job;
}

export async function readStrategyScanReport(userId: string, reportId: string) {
  const row = await prisma.strategyScanReport
    .findFirst({
      where: { id: reportId, userId: userId },
      include: { job: true },
    })
    .then((row) => (row ? strategyScanReportState(row) : row));

  if (!row) {
    throw new StrategyError('strategy_scan_not_found');
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
    jobId: row.job?.id ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
