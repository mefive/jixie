import { prisma } from '#infra/database/prisma.js';
import type { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { getMaintenanceState } from '../publication/watermark.js';

/**
 * 标识维护工作流种类，供状态查询和恢复使用。
 * Identify maintenance workflow kinds for status and recovery.
 */
export type MaintenanceKind = 'daily' | 'weekly' | 'repair' | 'deploy';

/**
 * 记录维护由手动还是定时触发，供审计与调度规则使用。
 * Identify how maintenance was triggered for auditing and scheduling rules.
 */
export type MaintenanceTrigger = 'timer' | 'manual';

/**
 * 约束维护运行状态，供可用性门禁与恢复逻辑使用。
 * Define maintenance run states for availability gates and recovery.
 */
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

/**
 * 持有本轮维护身份及更新能力，供阶段记录和最终收尾。
 * Carry the current maintenance identity and update capabilities through workflow stages.
 */
export interface MaintenanceRunHandle {
  id: string;
  skipped: boolean;
}

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * 重试沿用原运行日期范围，不因当前时间推进而改变任务范围。
 * A retry owns its original range even after the wall clock advances.
 */
export async function getPendingDailyRun(publishedThrough: string | null) {
  return prisma.maintenanceRun.findFirst({
    where: {
      kind: 'daily',
      status: { in: ['error', 'waiting'] },
      NOT: { targetKey: { startsWith: 'baseline:' } },
      endDate: publishedThrough ? { gt: publishedThrough } : { not: null },
    },
    orderBy: { startedAt: 'asc' },
  });
}

/**
 * 只允许纯预检尝试记录为非阻塞来源等待，不能降级历史或已写入的错误。
 * Only preflight-only attempts can be non-blocking. Never downgrade a legacy/dirty error.
 */
export async function recordDailySourceWait(input: {
  startDate: string;
  endDate: string;
  trigger: MaintenanceTrigger;
  error: string;
}): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    const existing = await transaction.maintenanceRun.findUnique({
      where: { kind_targetKey: { kind: 'daily', targetKey: input.endDate } },
    });
    if (existing && existing.status !== 'waiting') {
      return;
    }
    const now = new Date();
    const data = {
      status: 'waiting',
      stage: 'waiting_source',
      error: input.error,
      heartbeatAt: now,
      finishedAt: now,
      trigger: input.trigger,
      startDate: input.startDate,
      endDate: input.endDate,
    };
    if (existing) {
      await transaction.maintenanceRun.update({
        where: { id: existing.id },
        data: { ...data, attempts: { increment: 1 } },
      });
    } else {
      await transaction.maintenanceRun.create({
        data: { ...data, id: ulid(), kind: 'daily', targetKey: input.endDate },
      });
    }
  });
}

/**
 * 登记维护运行并建立执行范围，供后续阶段持久化检查点。
 * Create a maintenance run and its execution range for subsequent checkpoints.
 */
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

/**
 * 写入维护终态、摘要或错误，供发布门禁及重试读取。
 * Persist maintenance completion, summary or failure for publication gates and retries.
 */
export async function finishMaintenanceRun(
  runId: string,
  status: 'done' | 'error',
  options: { summary?: unknown; error?: string } = {},
): Promise<void> {
  const finish = prisma.maintenanceRun.update({
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
  if (status === 'done') {
    await prisma.$transaction([
      finish,
      prisma.maintenanceCheckpoint.deleteMany({ where: { runId } }),
    ]);
    return;
  }

  await finish;
}

export async function completedMaintenanceItems(
  runId: string,
  stage: string,
): Promise<Set<string>> {
  const rows = await prisma.maintenanceCheckpoint.findMany({
    where: { runId, stage },
    select: { itemKey: true },
  });
  return new Set(rows.map((row) => row.itemKey));
}

export async function completeMaintenanceItem(
  runId: string,
  stage: string,
  itemKey: string,
): Promise<void> {
  await prisma.maintenanceCheckpoint.upsert({
    where: { runId_stage_itemKey: { runId, stage, itemKey } },
    create: { runId, stage, itemKey },
    update: { completedAt: new Date() },
  });
}

/**
 * 汇总维护运行和水位状态，供前端与可用性中间件读取。
 * Collect maintenance run and watermark state for UI and availability middleware.
 */
export async function getMaintenanceStatus(): Promise<MaintenanceStatus> {
  const [running, latestDailyError, latestWeekly, latestRepairError, state, waiting] =
    await Promise.all([
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
      prisma.maintenanceRun.findFirst({
        where: { kind: 'daily', status: 'waiting' },
        orderBy: { startedAt: 'asc' },
      }),
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
  const visibleRun =
    activeRun ??
    (state.dailyPublishedThrough &&
    waiting?.endDate &&
    waiting.endDate > state.dailyPublishedThrough
      ? waiting
      : null);
  const summary = asSummary(visibleRun?.summary);

  return {
    active: activeRun != null,
    runId: visibleRun?.id ?? null,
    kind: (visibleRun?.kind as MaintenanceKind | undefined) ?? null,
    startDate: visibleRun?.startDate ?? null,
    endDate: visibleRun?.endDate ?? null,
    completedDates: numberField(summary, 'completedDates'),
    totalDates: numberField(summary, 'totalDates'),
    lastSuccessfulDailyDate: state.dailyPublishedThrough,
    stage: visibleRun?.stage ?? null,
    startedAt: visibleRun?.startedAt.toISOString() ?? null,
    heartbeatAt: visibleRun?.heartbeatAt.toISOString() ?? null,
    error: visibleRun?.error ?? null,
    retryAfterSeconds: 5,
  };
}

/**
 * 在持有跨进程锁后恢复遗留 running 记录，因为其原进程已不再拥有该锁。
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

/**
 * 在耗时网络阶段定期更新维护心跳，保持状态查询可判断活性。
 * Keep status polling fresh while a single network-heavy stage is running.
 */
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

function asSummary(value: Prisma.JsonValue | undefined): Record<string, Prisma.JsonValue> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

function numberField(summary: Record<string, Prisma.JsonValue>, key: string): number {
  return typeof summary[key] === 'number' ? summary[key] : 0;
}
