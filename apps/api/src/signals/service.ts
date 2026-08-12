import { createHash } from 'node:crypto';
import { fork, type ChildProcess } from 'node:child_process';
import { ulid } from 'ulid';
import { z } from 'zod';
import type {
  BacktestConfig,
  FactorInputSummary,
  Locale,
  LogLine,
  ModelPositionSnapshot,
  SignalItem,
  SignalRun,
  StrategyDeployment,
} from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import { codeConfigSchema } from '../strategy/code/schema.js';
import { inspectWalledStrategyMetadata } from '../engine/walled-run.js';
import { prepareStrategyFactors } from '../engine/prepare-custom-factors.js';
import { appendLog, finishSignalRunJob, initializeJobLogs } from '../lib/jobs.js';
import { waitForJobCompletion, wakeJobQueue } from '../lib/job-queue.js';
import { prisma } from '../lib/prisma.js';
import { t } from '../i18n/messages.js';
import { governmentYieldCurveReady } from '../rates/signal-readiness.js';
import { notifySignalRun } from './notifier.js';
import { executionWire, initializeSignalAccounting } from './accounting.js';
import { factorDependenciesFromJson } from './factor-dependency-lineage.js';

const workerUrl = import.meta.url.endsWith('.ts')
  ? new URL('../engine/signal-worker.boot.mjs', import.meta.url)
  : new URL('../engine/signal-worker.js', import.meta.url);

export type DeployStrategyResult =
  | { kind: 'ready'; deployment: StrategyDeployment }
  | { kind: 'not_found' }
  | { kind: 'no_backtest' }
  | { kind: 'language_unsupported' }
  | { kind: 'futures_unsupported' };

export async function deployStrategy(
  userId: string,
  strategyId: string,
  locale: Locale,
): Promise<DeployStrategyResult> {
  const strategy = await prisma.strategy.findFirst({
    where: { id: strategyId, userId },
    select: { id: true, name: true, config: true, lastResult: true },
  });
  if (!strategy) {
    return { kind: 'not_found' };
  }
  if (strategy.lastResult == null) {
    return { kind: 'no_backtest' };
  }

  const config = codeConfigSchema.parse(strategy.config) as BacktestConfig;
  if ((config.language ?? 'typescript') === 'python') {
    return { kind: 'language_unsupported' };
  }
  const metadata = await inspectWalledStrategyMetadata(config.code);
  if (metadata.futures.length > 0) {
    return { kind: 'futures_unsupported' };
  }
  // The UI pre-disables this path, but deployment safety is an API invariant: research-only or
  // archived factors must never become a new daily-signal dependency through a direct request.
  const prepared = await prepareStrategyFactors(config.code, userId, locale, 'deployment');

  const frozenConfig = { ...config, name: strategy.name };
  const codeHash = createHash('sha256').update(frozenConfig.code).digest('hex');
  const row = await prisma.$transaction(async (transaction) => {
    await transaction.strategyDeployment.updateMany({
      where: { strategyId, userId, status: 'active' },
      data: { status: 'paused', stoppedAt: new Date() },
    });
    return transaction.strategyDeployment.create({
      data: {
        id: ulid(),
        userId,
        strategyId,
        strategyName: strategy.name,
        status: 'active',
        config: frozenConfig as unknown as Prisma.InputJsonValue,
        factorDependencies: prepared.factors as unknown as Prisma.InputJsonValue,
        codeHash,
        locale,
      },
    });
  });

  return { kind: 'ready', deployment: deploymentWire(row) };
}

export async function pauseDeployment(
  userId: string,
  deploymentId: string,
): Promise<StrategyDeployment | null> {
  const deployment = await prisma.strategyDeployment.findFirst({
    where: { id: deploymentId, userId },
  });
  if (!deployment) {
    return null;
  }
  if (deployment.status === 'paused') {
    return deploymentWire(deployment);
  }
  const updated = await prisma.strategyDeployment.update({
    where: { id: deployment.id },
    data: { status: 'paused', stoppedAt: new Date() },
  });
  return deploymentWire(updated);
}

export async function currentDeployment(
  userId: string,
  strategyId: string,
): Promise<StrategyDeployment | null> {
  const row = await prisma.strategyDeployment.findFirst({
    where: { userId, strategyId, status: 'active' },
    orderBy: { deployedAt: 'desc' },
  });
  return row ? deploymentWire(row) : null;
}

export async function listTodaySignals(
  userId: string,
): Promise<Array<{ deployment: StrategyDeployment; run: SignalRun | null }>> {
  const rows = await prisma.strategyDeployment.findMany({
    where: { userId, status: 'active' },
    orderBy: { deployedAt: 'desc' },
    include: {
      signalRuns: {
        orderBy: { tradeDate: 'desc' },
        take: 1,
        include: {
          jobs: { orderBy: { createdAt: 'desc' }, take: 1 },
          executions: { orderBy: { signalIndex: 'asc' } },
        },
      },
    },
  });
  return rows.map((row) => ({
    deployment: deploymentWire(row),
    run: row.signalRuns[0] ? signalRunWire(row.signalRuns[0], row.strategyName) : null,
  }));
}

export async function listSignalRuns(
  userId: string,
  deploymentId: string,
  limit: number,
): Promise<SignalRun[] | null> {
  const deployment = await prisma.strategyDeployment.findFirst({
    where: { id: deploymentId, userId },
    select: { id: true, strategyName: true },
  });
  if (!deployment) {
    return null;
  }
  const rows = await prisma.signalRun.findMany({
    where: { deploymentId, userId },
    orderBy: { tradeDate: 'desc' },
    take: limit,
    include: {
      jobs: { orderBy: { createdAt: 'desc' }, take: 1 },
      executions: { orderBy: { signalIndex: 'asc' } },
    },
  });
  return rows.map((row) => signalRunWire(row, deployment.strategyName));
}

export async function getSignalRun(userId: string, runId: string): Promise<SignalRun | null> {
  const row = await prisma.signalRun.findFirst({
    where: { id: runId, userId },
    include: {
      deployment: { select: { strategyName: true } },
      jobs: { orderBy: { createdAt: 'desc' }, take: 1 },
      executions: { orderBy: { signalIndex: 'asc' } },
    },
  });
  return row ? signalRunWire(row, row.deployment.strategyName) : null;
}

export interface EnqueuedSignalRun {
  runId: string;
  jobId: string | null;
  started: boolean;
  completion: Promise<'done' | 'error' | 'running'>;
}

export async function enqueueSignalRun(
  userId: string,
  deploymentId: string,
  tradeDate: string,
): Promise<
  | { kind: 'ready'; run: EnqueuedSignalRun }
  | { kind: 'not_found' }
  | { kind: 'paused' }
  | { kind: 'invalid_date' }
  | { kind: 'next_date_missing' }
  | { kind: 'data_not_ready' }
> {
  const deployment = await prisma.strategyDeployment.findFirst({
    where: { id: deploymentId, userId },
    select: { id: true, status: true, locale: true, factorDependencies: true },
  });
  if (!deployment) {
    return { kind: 'not_found' };
  }
  if (deployment.status !== 'active') {
    return { kind: 'paused' };
  }

  const calendar = await signalCalendar(tradeDate);
  if (calendar.kind !== 'ready') {
    return calendar;
  }
  if (!(await signalDataReady(tradeDate))) {
    return { kind: 'data_not_ready' };
  }
  const factorDependencies = factorDependenciesFromJson(deployment.factorDependencies) ?? [];
  if (!(await governmentYieldCurveReady(factorDependencies, tradeDate))) {
    return { kind: 'data_not_ready' };
  }

  const start = await prisma.$transaction(async (transaction) => {
    const existing = await transaction.signalRun.findUnique({
      where: { deploymentId_tradeDate: { deploymentId, tradeDate } },
      include: { jobs: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (existing?.status === 'done') {
      return {
        kind: 'existing' as const,
        runId: existing.id,
        jobId: existing.jobs[0]?.id ?? null,
        status: 'done' as const,
      };
    }
    if (existing?.status === 'running') {
      return {
        kind: 'existing' as const,
        runId: existing.id,
        jobId: existing.jobs[0]?.id ?? null,
        status: 'running' as const,
      };
    }

    const runId = existing?.id ?? ulid();
    if (existing) {
      await transaction.signalRun.update({
        where: { id: runId },
        data: {
          status: 'running',
          execDate: calendar.execDate,
          error: null,
          dataCutoff: null,
          modelEquity: null,
          modelCash: null,
          modelPositions: [] as Prisma.InputJsonValue,
          signals: [] as Prisma.InputJsonValue,
          factorInputs: [] as Prisma.InputJsonValue,
          notifiedAt: null,
          notificationError: null,
        },
      });
    } else {
      await transaction.signalRun.create({
        data: {
          id: runId,
          userId,
          deploymentId,
          strategyId: await deploymentStrategyId(transaction, deploymentId),
          tradeDate,
          execDate: calendar.execDate,
          status: 'running',
          factorDependencies:
            deployment.factorDependencies == null
              ? undefined
              : (deployment.factorDependencies as Prisma.InputJsonValue),
        },
      });
    }

    const jobId = ulid();
    await transaction.job.create({
      data: {
        id: jobId,
        userId,
        kind: 'signal',
        key: runId,
        status: 'queued',
        signalRunId: runId,
        payload: {
          task: 'signal',
          runId,
          locale: deployment.locale === 'en' ? 'en' : 'zh',
        },
      },
    });
    return { kind: 'start' as const, runId, jobId };
  });

  if (start.kind === 'existing') {
    const completion = start.jobId
      ? waitForJobCompletion(start.jobId).then((status) =>
          status === 'done' ? ('done' as const) : ('error' as const),
        )
      : Promise.resolve(start.status);
    return {
      kind: 'ready',
      run: {
        runId: start.runId,
        jobId: start.jobId,
        started: false,
        completion,
      },
    };
  }

  initializeJobLogs(start.jobId);
  wakeJobQueue();
  const completion = waitForJobCompletion(start.jobId).then((status) =>
    status === 'done' ? ('done' as const) : ('error' as const),
  );
  return {
    kind: 'ready',
    run: {
      runId: start.runId,
      jobId: start.jobId,
      started: true,
      completion,
    },
  };
}

const signalJobPayloadSchema = z.object({
  task: z.literal('signal'),
  runId: z.string().min(1),
  locale: z.enum(['zh', 'en']),
});

/** Reconstruct and execute a daily-signal Job claimed by the shared scheduler. */
export async function runSignalJob(
  jobId: string,
  rawPayload: Record<string, unknown>,
): Promise<void> {
  const payload = signalJobPayloadSchema.parse(rawPayload);
  await startSignalWorker({ jobId, runId: payload.runId, locale: payload.locale });
}

async function startSignalWorker(input: {
  runId: string;
  jobId: string;
  locale: Locale;
}): Promise<'done' | 'error'> {
  let worker: ChildProcess;
  try {
    worker = fork(workerUrl, [input.runId], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishSignalRunJob(input.jobId, input.runId, 'error', undefined, message);
    await notifySignalRun(input.runId);
    return 'error';
  }

  return new Promise((resolve) => {
    let finished = false;
    let terminalMessage:
      | { status: 'done'; output: SignalWorkerOutput }
      | { status: 'error'; error?: string }
      | null = null;
    const finish = async (
      status: 'done' | 'error',
      output?: SignalWorkerOutput,
      error?: string,
    ) => {
      if (finished) {
        return;
      }
      finished = true;
      if (status === 'done' && output) {
        await finishSignalRunJob(input.jobId, input.runId, 'done', {
          dataCutoff: output.dataCutoff,
          modelEquity: output.modelEquity,
          modelCash: output.modelCash,
          modelPositions: output.modelPositions as unknown as Prisma.InputJsonValue,
          signals: output.signals as unknown as Prisma.InputJsonValue,
          factorInputs: output.factorInputs as unknown as Prisma.InputJsonValue,
        });
        await initializeSignalAccounting(input.runId);
      } else {
        await finishSignalRunJob(input.jobId, input.runId, 'error', undefined, error);
      }
      await notifySignalRun(input.runId);
      resolve(status);
    };

    worker.on('message', (message: SignalWorkerMessage) => {
      if (message.type === 'log') {
        appendLog(input.jobId, message.entry);
      } else if (message.type === 'done') {
        terminalMessage = { status: 'done', output: message.output };
      } else if (message.type === 'error') {
        terminalMessage = { status: 'error', error: message.message };
      }
    });
    worker.on('error', (error) => void finish('error', undefined, error.message));
    worker.on('exit', (code) => {
      if (finished) {
        return;
      }
      if (code !== 0 || !terminalMessage) {
        const error =
          code === 0
            ? 'Signal process exited before returning a result'
            : t(input.locale, 'signalProcExited', { code: code ?? 'unknown' });
        void finish('error', undefined, error);
      } else if (terminalMessage.status === 'error') {
        void finish('error', undefined, terminalMessage.error);
      } else {
        void finish('done', terminalMessage.output);
      }
    });
  });
}

export async function latestCompletedTradeDate(): Promise<string | null> {
  const { today, hour } = shanghaiClock();
  const upperBound = hour >= 16 ? today : previousCalendarDate(today);
  const row = await prisma.tradeCal.findFirst({
    where: { exchange: 'SSE', isOpen: 1, calDate: { lte: upperBound } },
    orderBy: { calDate: 'desc' },
    select: { calDate: true },
  });
  return row?.calDate ?? null;
}

async function signalCalendar(
  tradeDate: string,
): Promise<
  { kind: 'ready'; execDate: string } | { kind: 'invalid_date' } | { kind: 'next_date_missing' }
> {
  if (!/^\d{8}$/.test(tradeDate) || !isCompletedShanghaiDate(tradeDate)) {
    return { kind: 'invalid_date' };
  }
  const row = await prisma.tradeCal.findUnique({
    where: { exchange_calDate: { exchange: 'SSE', calDate: tradeDate } },
  });
  if (!row || row.isOpen !== 1) {
    return { kind: 'invalid_date' };
  }
  const next = await prisma.tradeCal.findFirst({
    where: { exchange: 'SSE', isOpen: 1, calDate: { gt: tradeDate } },
    orderBy: { calDate: 'asc' },
    select: { calDate: true },
  });
  return next ? { kind: 'ready', execDate: next.calDate } : { kind: 'next_date_missing' };
}

export async function signalDataReady(tradeDate: string): Promise<boolean> {
  const [daily, adjustment, basic, limits] = await Promise.all([
    prisma.daily.count({ where: { tradeDate } }),
    prisma.adjFactor.count({ where: { tradeDate } }),
    prisma.dailyBasic.count({ where: { tradeDate } }),
    prisma.stkLimit.count({ where: { tradeDate } }),
  ]);
  return daily > 0 && adjustment > 0 && basic > 0 && limits > 0;
}

function isCompletedShanghaiDate(tradeDate: string): boolean {
  const { today, hour } = shanghaiClock();
  return tradeDate < today || (tradeDate === today && hour >= 16);
}

function shanghaiClock(): { today: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    today: `${value.year}${value.month}${value.day}`,
    hour: Number(value.hour),
  };
}

function previousCalendarDate(date: string): string {
  const utc = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(4, 6)) - 1,
    Number(date.slice(6, 8)) - 1,
  );
  return new Date(utc).toISOString().slice(0, 10).replaceAll('-', '');
}

async function deploymentStrategyId(
  transaction: Prisma.TransactionClient,
  deploymentId: string,
): Promise<string> {
  const deployment = await transaction.strategyDeployment.findUniqueOrThrow({
    where: { id: deploymentId },
    select: { strategyId: true },
  });
  return deployment.strategyId;
}

export function deploymentWire(row: {
  id: string;
  strategyId: string;
  strategyName: string;
  status: string;
  config: unknown;
  factorDependencies: unknown;
  codeHash: string;
  locale: string;
  deployedAt: Date;
  stoppedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): StrategyDeployment {
  return {
    id: row.id,
    strategyId: row.strategyId,
    strategyName: row.strategyName,
    status: row.status === 'active' ? 'active' : 'paused',
    config: row.config as unknown as BacktestConfig,
    factorDependencies: factorDependenciesFromJson(row.factorDependencies) ?? [],
    codeHash: row.codeHash,
    locale: row.locale === 'en' ? 'en' : 'zh',
    deployedAt: row.deployedAt.toISOString(),
    stoppedAt: row.stoppedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function signalRunWire(
  row: {
    id: string;
    deploymentId: string;
    strategyId: string;
    tradeDate: string;
    execDate: string;
    status: string;
    factorDependencies: unknown;
    factorInputs: unknown;
    dataCutoff: string | null;
    modelEquity: number | null;
    modelCash: number | null;
    modelPositions: unknown;
    signals: unknown;
    error: string | null;
    notifiedAt: Date | null;
    notificationError: string | null;
    createdAt: Date;
    updatedAt: Date;
    jobs?: Array<{ id: string }>;
    executions?: Parameters<typeof executionWire>[0][];
  },
  strategyName: string,
): SignalRun {
  return {
    id: row.id,
    deploymentId: row.deploymentId,
    strategyId: row.strategyId,
    strategyName,
    tradeDate: row.tradeDate,
    execDate: row.execDate,
    status:
      row.status === 'done' || row.status === 'error' || row.status === 'stale'
        ? row.status
        : 'running',
    factorDependencies: factorDependenciesFromJson(row.factorDependencies) ?? [],
    factorInputs: Array.isArray(row.factorInputs)
      ? (row.factorInputs as unknown as FactorInputSummary[])
      : [],
    dataCutoff: row.dataCutoff,
    modelEquity: row.modelEquity,
    modelCash: row.modelCash,
    modelPositions: Array.isArray(row.modelPositions)
      ? (row.modelPositions as unknown as ModelPositionSnapshot[])
      : [],
    signals: Array.isArray(row.signals) ? (row.signals as unknown as SignalItem[]) : [],
    executions: row.executions?.map(executionWire) ?? [],
    error: row.error,
    notifiedAt: row.notifiedAt?.toISOString() ?? null,
    notificationError: row.notificationError,
    jobId: row.jobs?.[0]?.id ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

interface SignalWorkerOutput {
  dataCutoff: string;
  modelEquity: number;
  modelCash: number;
  modelPositions: ModelPositionSnapshot[];
  signals: SignalItem[];
  factorInputs: FactorInputSummary[];
}

type SignalWorkerMessage =
  | { type: 'log'; entry: LogLine }
  | { type: 'done'; output: SignalWorkerOutput }
  | { type: 'error'; message: string };
