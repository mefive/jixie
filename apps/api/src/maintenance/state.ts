import { ulid } from 'ulid';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export type MaintenanceKind = 'daily' | 'weekly' | 'repair' | 'deploy';
export type MaintenanceTrigger = 'timer' | 'manual';

export interface MaintenanceStatus {
  active: boolean;
  runId: string | null;
  kind: MaintenanceKind | null;
  startDate: string | null;
  endDate: string | null;
  completedDates: number;
  totalDates: number;
  lastSuccessfulDailyDate: string | null;
  stage: string | null;
  startedAt: string | null;
  heartbeatAt: string | null;
  error: string | null;
  retryAfterSeconds: number;
}

export interface MaintenanceRunHandle {
  id: string;
  skipped: boolean;
}

const STATE_KEY = 'global';
const HEARTBEAT_INTERVAL_MS = 30_000;

export async function beginMaintenanceRun(input: {
  kind: MaintenanceKind;
  targetKey: string;
  startDate?: string;
  endDate?: string;
  trigger: MaintenanceTrigger;
  force?: boolean;
}): Promise<MaintenanceRunHandle> {
  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.maintenanceRun.findUnique({
      where: { kind_targetKey: { kind: input.kind, targetKey: input.targetKey } },
    });
    if (existing?.status === 'done' && !input.force) {
      return { id: existing.id, skipped: true };
    }

    const now = new Date();
    if (existing) {
      await transaction.maintenanceRun.update({
        where: { id: existing.id },
        data: {
          startDate: input.startDate ?? null,
          endDate: input.endDate ?? null,
          trigger: input.trigger,
          status: 'running',
          stage: 'starting',
          attempts: { increment: 1 },
          summary: undefined,
          error: null,
          heartbeatAt: now,
          startedAt: now,
          finishedAt: null,
        },
      });
      return { id: existing.id, skipped: false };
    }

    const id = ulid();
    await transaction.maintenanceRun.create({
      data: {
        id,
        kind: input.kind,
        targetKey: input.targetKey,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        trigger: input.trigger,
        status: 'running',
        stage: 'starting',
      },
    });
    return { id, skipped: false };
  });
}

export async function updateMaintenanceRun(
  runId: string,
  stage: string,
  summary?: unknown,
): Promise<void> {
  await prisma.maintenanceRun.update({
    where: { id: runId },
    data: {
      stage,
      summary: summary as Prisma.InputJsonValue | undefined,
      heartbeatAt: new Date(),
    },
  });
}

export async function finishMaintenanceRun(
  runId: string,
  status: 'done' | 'error',
  options: { summary?: unknown; error?: string } = {},
): Promise<void> {
  await prisma.maintenanceRun.update({
    where: { id: runId },
    data: {
      status,
      stage: status === 'done' ? 'complete' : 'error',
      summary: options.summary as Prisma.InputJsonValue | undefined,
      error: status === 'error' ? (options.error ?? 'Maintenance failed') : null,
      heartbeatAt: new Date(),
      finishedAt: new Date(),
    },
  });
}

export async function getMaintenanceStatus(): Promise<MaintenanceStatus> {
  const [running, latestDailyError, latestWeekly, latestRepairError, state] = await Promise.all([
    prisma.maintenanceRun.findFirst({
      where: { status: 'running' },
      orderBy: { startedAt: 'desc' },
    }),
    prisma.maintenanceRun.findFirst({
      where: { kind: 'daily', status: 'error' },
      orderBy: { startedAt: 'desc' },
    }),
    prisma.maintenanceRun.findFirst({
      where: { kind: 'weekly' },
      orderBy: { startedAt: 'desc' },
    }),
    prisma.maintenanceRun.findFirst({
      where: { kind: 'repair', status: 'error' },
      orderBy: { startedAt: 'desc' },
    }),
    getMaintenanceState(),
  ]);
  const blockingDailyError =
    !running &&
    latestDailyError?.endDate != null &&
    (state.dailyPublishedThrough == null || latestDailyError.endDate > state.dailyPublishedThrough)
      ? latestDailyError
      : null;
  const blockingWeeklyError = latestWeekly?.status === 'error' ? latestWeekly : null;
  const blockingError = [blockingDailyError, blockingWeeklyError, latestRepairError]
    .filter((run) => run != null)
    .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime())[0];
  const activeRun = running ?? blockingError;
  const summary = asSummary(activeRun?.summary);

  return {
    active: activeRun != null,
    runId: activeRun?.id ?? null,
    kind: (activeRun?.kind as MaintenanceKind | undefined) ?? null,
    startDate: activeRun?.startDate ?? null,
    endDate: activeRun?.endDate ?? null,
    completedDates: numberField(summary, 'completedDates'),
    totalDates: numberField(summary, 'totalDates'),
    lastSuccessfulDailyDate: state.dailyPublishedThrough,
    stage: activeRun?.stage ?? null,
    startedAt: activeRun?.startedAt.toISOString() ?? null,
    heartbeatAt: activeRun?.heartbeatAt.toISOString() ?? null,
    error: activeRun?.error ?? null,
    retryAfterSeconds: 5,
  };
}

/**
 * The caller holds the cross-process flock, so any pre-existing running row belongs to a process
 * that no longer owns the lock. Converting it to an error makes crash recovery explicit and keeps
 * the next run from leaving an immortal maintenance Gate behind.
 */
export async function recoverInterruptedMaintenanceRuns(): Promise<number> {
  const now = new Date();
  const result = await prisma.maintenanceRun.updateMany({
    where: { status: 'running' },
    data: {
      status: 'error',
      stage: 'interrupted',
      error: 'Previous maintenance process exited before recording a terminal state',
      heartbeatAt: now,
      finishedAt: now,
    },
  });
  return result.count;
}

/** Keep status polling fresh while a single network-heavy stage is running. */
export function startMaintenanceHeartbeat(runId: string): () => Promise<void> {
  let pending: Promise<unknown> | null = null;
  const timer = setInterval(() => {
    if (pending) {
      return;
    }
    pending = prisma.maintenanceRun
      .updateMany({
        where: { id: runId, status: 'running' },
        data: { heartbeatAt: new Date() },
      })
      .catch(() => {})
      .finally(() => {
        pending = null;
      });
  }, HEARTBEAT_INTERVAL_MS);
  timer.unref?.();

  return async () => {
    clearInterval(timer);
    await pending;
  };
}

export async function getMaintenanceState(): Promise<{
  dailyPublishedThrough: string | null;
  weeklySyncedThrough: string | null;
  dataRevision: number;
}> {
  const row = await prisma.maintenanceState.findUnique({
    where: { key: STATE_KEY },
  });
  return {
    dailyPublishedThrough: row?.dailyPublishedThrough ?? null,
    weeklySyncedThrough: row?.weeklySyncedThrough ?? null,
    dataRevision: row?.dataRevision ?? 0,
  };
}

export async function initializeDailyWatermark(tradeDate: string): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    const current = await transaction.maintenanceState.findUnique({
      where: { key: STATE_KEY },
    });
    if (!current) {
      await transaction.maintenanceState.create({
        data: { key: STATE_KEY, dailyPublishedThrough: tradeDate, dataRevision: 1 },
      });
      return;
    }
    if (current.dailyPublishedThrough === tradeDate) {
      return;
    }
    if (current.dailyPublishedThrough) {
      throw new Error(
        `dailyPublishedThrough is already initialized to ${current.dailyPublishedThrough}; use maintenance daily or maintenance repair`,
      );
    }
    await transaction.maintenanceState.update({
      where: { key: STATE_KEY },
      data: { dailyPublishedThrough: tradeDate, dataRevision: { increment: 1 } },
    });
  });
}

export async function advanceDailyWatermark(tradeDate: string): Promise<number> {
  const row = await prisma.$transaction(async (transaction) => {
    const current = await transaction.maintenanceState.findUnique({
      where: { key: STATE_KEY },
    });
    if (!current) {
      return transaction.maintenanceState.create({
        data: { key: STATE_KEY, dailyPublishedThrough: tradeDate, dataRevision: 1 },
      });
    }
    return transaction.maintenanceState.update({
      where: { key: STATE_KEY },
      data: {
        dailyPublishedThrough:
          !current.dailyPublishedThrough || tradeDate > current.dailyPublishedThrough
            ? tradeDate
            : current.dailyPublishedThrough,
        dataRevision: { increment: 1 },
      },
    });
  });
  return row.dataRevision;
}

export async function bumpDataRevision(): Promise<number> {
  const row = await prisma.maintenanceState.upsert({
    where: { key: STATE_KEY },
    create: { key: STATE_KEY, dataRevision: 1 },
    update: { dataRevision: { increment: 1 } },
  });
  return row.dataRevision;
}

export async function advanceWeeklyWatermark(date: string): Promise<number> {
  const row = await prisma.maintenanceState.upsert({
    where: { key: STATE_KEY },
    create: { key: STATE_KEY, weeklySyncedThrough: date, dataRevision: 1 },
    update: { weeklySyncedThrough: date, dataRevision: { increment: 1 } },
  });
  return row.dataRevision;
}

function asSummary(value: Prisma.JsonValue | undefined): Record<string, Prisma.JsonValue> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

function numberField(summary: Record<string, Prisma.JsonValue>, key: string): number {
  return typeof summary[key] === 'number' ? summary[key] : 0;
}
