import {
  actualSignalResolutionSchema,
  simulatedSignalResolutionSchema,
} from '@jixie/shared/api/signals';
import { createHash } from 'node:crypto';
import { loadSignalMarketInput } from './futures-market.js';
import type { SignalMarketRevisionInput, SignalTaskDecisionInput } from '@jixie/shared/api/signals';
import { summarizeSignalExecution } from './execution-summary.js';
import { isCompletedShanghaiDate } from '#market/calendar/sse-close.js';
import { ulid } from 'ulid';
import type { Prisma } from '@prisma/client';
import type { SignalAccountHistory } from '@jixie/shared';
import {
  signalAccountsSchema,
  signalFillSchema,
  type SignalFillInput,
  type SignalFillRevisionInput,
  type SignalResolutionInput,
} from '@jixie/shared/api/signals';
import { getDatabase } from '#infra/database/prisma.js';
import {
  applyFutureFill,
  resolveFutureLegs,
  resolveFutureTarget,
} from '#backtesting/futures-accounting.js';
import { SignalsError } from '../errors.js';
import { parseTaskIntent } from './versioned.js';
import { rebuildVersionedAccount } from './versioned-replay.js';

async function ownedTask(userId: string, executionId: string) {
  const task = await getDatabase().signalExecution.findFirst({
    where: { id: executionId, userId, version: 2 },
    include: { deployment: true },
  });
  if (!task?.deployment || !task.deploymentId || !task.execDate) {
    throw new SignalsError('execution_not_found');
  }

  return task as typeof task & {
    deployment: NonNullable<typeof task.deployment>;
    deploymentId: string;
    execDate: string;
  };
}

/**
 * 按用户与部署归属解析实际信号任务，供成交录入授权。
 *
 * Resolve an actual signal task within its user and deployment ownership.
 */
export async function resolveActualSignal(
  userId: string,
  executionId: string,
  input: SignalResolutionInput,
) {
  const task = await ownedTask(userId, executionId);
  const requestKey = `${userId}:${input.clientRequestId}`;
  const existing = await getDatabase().signalResolution.findUnique({ where: { requestKey } });
  if (existing) {
    if (
      existing.executionId !== executionId ||
      JSON.stringify(actualSignalResolutionSchema.parse(existing.payload).input) !==
        JSON.stringify(input)
    ) {
      throw new SignalsError('execution_unavailable');
    }
    return existing;
  }
  const intent = parseTaskIntent(task.intent);
  if (
    intent.assetType !== 'future' ||
    task.deployment.accountInputRevision !== input.expectedRevision
  ) {
    throw new SignalsError('execution_unavailable');
  }
  const prior = await getDatabase().signalAccountState.findFirst({
    where: {
      deploymentId: task.deploymentId,
      kind: 'actual',
      generation: task.deployment.actualGeneration ?? 'baseline',
      tradeDate: { lt: task.execDate },
    },
    orderBy: { tradeDate: 'desc' },
  });
  const baseline =
    prior ??
    (await getDatabase().signalAccountState.findFirst({
      where: {
        deploymentId: task.deploymentId,
        kind: 'actual',
        generation: 'baseline',
        tradeDate: { lt: task.execDate },
      },
    }));
  if (
    !baseline ||
    (task.deployment.dirtyFromDate && task.deployment.dirtyFromDate < task.execDate)
  ) {
    throw new SignalsError('execution_unavailable');
  }
  const state = signalAccountsSchema.parse(baseline.payload);
  const asOfDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date(input.exposureAsOf))
    .replaceAll('-', '');
  if (asOfDate !== task.execDate || Date.parse(input.exposureAsOf) > Date.now()) {
    throw new SignalsError('invalid_date');
  }
  const recorded = await getDatabase().signalFill.findMany({
    where: { deploymentId: task.deploymentId },
  });
  const superseded = new Set(recorded.flatMap((row) => (row.replacesId ? [row.replacesId] : [])));
  const basisFills = recorded
    .filter(
      (row) =>
        !row.voided &&
        !superseded.has(row.id) &&
        row.tradeDate > state.date &&
        row.tradeDate <= task.execDate,
    )
    .map((row) => ({ row, fill: signalFillSchema.parse(row.payload) }))
    .filter(({ fill }) => Date.parse(fill.executedAt) <= Date.parse(input.exposureAsOf))
    .sort(
      (left, right) =>
        Date.parse(left.fill.executedAt) - Date.parse(right.fill.executedAt) ||
        left.fill.sequence - right.fill.sequence,
    );
  for (const { fill, row } of basisFills) {
    const sourceTask = await getDatabase().signalExecution.findUniqueOrThrow({
      where: { id: row.executionId },
    });
    const sourceIntent = parseTaskIntent(sourceTask.intent);
    if (sourceIntent.assetType !== 'future') {
      continue;
    }
    const contract = await getDatabase().futureContract.findUniqueOrThrow({
      where: { tsCode: fill.actualCode },
    });
    if (!contract.multiplier) {
      throw new SignalsError('execution_unavailable');
    }
    const index = state.futures.positions.findIndex(
      (position) => position.code === sourceIntent.code && position.actualCode === fill.actualCode,
    );
    const applied = applyFutureFill({
      position: state.futures.positions[index] ?? null,
      code: sourceIntent.code,
      actualCode: fill.actualCode,
      delta: (fill.action === 'buy' ? 1 : -1) * fill.quantity,
      price: fill.price,
      multiplier: contract.multiplier,
      fee: fill.fee,
      marginRate:
        (task.deployment.config as { cost?: { futureMarginRate?: number } }).cost
          ?.futureMarginRate ?? 0.12,
    });
    if (index >= 0) {
      state.futures.positions.splice(index, 1);
    }
    if (applied.position) {
      state.futures.positions.push(applied.position);
    }
  }
  const current = state.futures.positions
    .filter((position) => position.code === intent.code)
    .reduce((sum, position) => sum + position.contracts, 0);
  const target = resolveFutureTarget({
    intent: intent.intent,
    current,
    price: input.price,
    multiplier: intent.multiplier,
    cashExposure: input.cashExposure,
  });
  const legs = resolveFutureLegs({
    code: intent.code,
    actualCode: intent.actualCode,
    multiplier: intent.multiplier,
    target,
    positions: state.futures.positions,
  });

  return getDatabase().$transaction(async (transaction) => {
    const current = await transaction.strategyDeployment.findUniqueOrThrow({
      where: { id: task.deploymentId },
    });
    if (current.accountInputRevision !== input.expectedRevision) {
      throw new SignalsError('execution_unavailable');
    }
    return transaction.signalResolution.create({
      data: {
        id: ulid(),
        deploymentId: task.deploymentId,
        executionId,
        kind: 'actual',
        requestKey,
        accountRevision: input.expectedRevision,
        payload: {
          input,
          target,
          legs,
          status: legs.length ? 'ready' : 'no_action',
          accountDate: state.date,
          fillIds: basisFills.map(({ row }) => row.id),
        },
      },
    });
  });
}

/**
 * 校验并保存人工录入的成交，更新关联执行任务与重放状态。
 *
 * Validate and persist a manually recorded fill and update related execution and replay state.
 */
export async function recordSignalFill(
  userId: string,
  executionId: string,
  input: SignalFillInput,
) {
  const task = await ownedTask(userId, executionId);
  const requestKey = `${userId}:${input.clientRequestId}`;
  const existing = await getDatabase().signalFill.findUnique({ where: { requestKey } });
  if (existing) {
    if (
      existing.executionId !== executionId ||
      JSON.stringify(existing.payload) !== JSON.stringify(input)
    ) {
      throw new SignalsError('execution_unavailable');
    }
    return { id: existing.id, replay: task.deployment.actualAccountStatus };
  }
  await validateFill(task, input);
  const row = await getDatabase().$transaction(async (transaction) => {
    const changed = await transaction.strategyDeployment.updateMany({
      where: { id: task.deploymentId, userId, accountInputRevision: input.expectedRevision },
      data: {
        accountInputRevision: { increment: 1 },
        dirtyFromDate: [
          task.deployment.dirtyFromDate ?? input.tradeDate,
          input.tradeDate,
        ].sort()[0],
        replayStatus: 'pending',
        actualAccountStatus: 'pending',
      },
    });
    if (changed.count !== 1) {
      throw new SignalsError('execution_unavailable');
    }
    return transaction.signalFill.create({
      data: {
        id: ulid(),
        deploymentId: task.deploymentId,
        executionId,
        requestKey,
        tradeDate: input.tradeDate,
        payload: input as Prisma.InputJsonValue,
      },
    });
  });
  const replay = await replayActualAfterFill(task.deploymentId);

  return { id: row.id, replay };
}

/**
 * 检查成交数量、价格、方向及任务匹配约束，避免无效录入污染账本。
 *
 * Validate fill quantities, prices, sides and task consistency before ledger posting.
 */
async function validateFill(
  task: Awaited<ReturnType<typeof ownedTask>>,
  input: SignalFillInput,
  replacesId?: string,
) {
  const intent = parseTaskIntent(task.intent);
  const baseline = await getDatabase().signalAccountState.findFirst({
    where: { deploymentId: task.deploymentId, generation: 'baseline' },
  });
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date(input.executedAt))
    .replaceAll('-', '');
  const calendar = await getDatabase().tradeCal.findUnique({
    where: { exchange_calDate: { exchange: 'SSE', calDate: input.tradeDate } },
  });
  if (
    !baseline ||
    input.tradeDate <= baseline.tradeDate ||
    input.tradeDate < task.execDate ||
    calendar?.isOpen !== 1 ||
    dateParts !== input.tradeDate ||
    Date.parse(input.executedAt) > Date.now()
  ) {
    throw new SignalsError('invalid_date');
  }
  if (intent.assetType === 'future') {
    const contract = await getDatabase().futureContract.findUnique({
      where: { tsCode: input.actualCode },
    });
    const reference = await getDatabase().futureContract.findUnique({
      where: { tsCode: intent.actualCode },
    });
    if (
      !contract ||
      !reference ||
      !['IF', 'IH', 'IC', 'IM'].includes(contract.productCode) ||
      contract.productCode !== reference.productCode ||
      contract.listDate > input.tradeDate ||
      contract.delistDate < input.tradeDate ||
      !Number.isInteger(input.quantity)
    ) {
      throw new SignalsError('execution_unavailable');
    }
  } else if (input.actualCode !== intent.code || input.action !== intent.action) {
    throw new SignalsError('execution_unavailable');
  }
  if (intent.assetType === 'future') {
    const currentState = signalAccountsSchema.parse(baseline.payload);
    const recorded = await getDatabase().signalFill.findMany({
      where: { deploymentId: task.deploymentId },
      include: { execution: true },
    });
    const superseded = new Set(recorded.flatMap((row) => (row.replacesId ? [row.replacesId] : [])));
    let contracts = currentState.futures.positions
      .filter(
        (position) => position.actualCode === input.actualCode && position.code === intent.code,
      )
      .reduce((sum, position) => sum + position.contracts, 0);
    for (const row of recorded.filter(
      (row) =>
        !row.voided &&
        row.id !== replacesId &&
        !superseded.has(row.id) &&
        row.tradeDate <= input.tradeDate,
    )) {
      const prior = signalFillSchema.parse(row.payload);
      const earlier =
        Date.parse(prior.executedAt) < Date.parse(input.executedAt) ||
        (Date.parse(prior.executedAt) === Date.parse(input.executedAt) &&
          prior.sequence < input.sequence);
      if (prior.actualCode === input.actualCode && row.execution.code === intent.code && earlier) {
        contracts += (prior.action === 'buy' ? 1 : -1) * prior.quantity;
      }
      if (
        Date.parse(prior.executedAt) === Date.parse(input.executedAt) &&
        prior.sequence === input.sequence
      ) {
        throw new SignalsError('execution_unavailable');
      }
    }
    const delta = (input.action === 'buy' ? 1 : -1) * input.quantity;
    if (
      (input.effect === 'close' &&
        (contracts * delta >= 0 || Math.abs(delta) > Math.abs(contracts))) ||
      (input.effect === 'open' && contracts * delta < 0)
    ) {
      throw new SignalsError('execution_shares_invalid');
    }
  }
  if (input.resolutionId) {
    const resolution = await getDatabase().signalResolution.findFirst({
      where: {
        id: input.resolutionId,
        executionId: task.id,
        deploymentId: task.deploymentId,
        kind: 'actual',
      },
    });
    if (!resolution) {
      throw new SignalsError('execution_unavailable');
    }
    const legs = actualSignalResolutionSchema.parse(resolution.payload).legs;
    if (
      input.legId &&
      !legs?.some(
        (leg) =>
          leg.id === input.legId &&
          leg.actualCode === input.actualCode &&
          leg.action === input.action &&
          leg.effect === input.effect,
      )
    ) {
      throw new SignalsError('execution_unavailable');
    }
  }
}

/**
 * 修订已录入成交并使受影响账户重新计算，保留版本化审计。
 *
 * Revise a recorded fill and rebuild affected versioned account results.
 */
export async function reviseSignalFill(
  userId: string,
  fillId: string,
  input: SignalFillRevisionInput,
) {
  const previous = await getDatabase().signalFill.findUnique({ where: { id: fillId } });
  if (!previous) {
    throw new SignalsError('execution_not_found');
  }
  const task = await ownedTask(userId, previous.executionId);
  const requestKey = `${userId}:${input.clientRequestId}`;
  const payload = input.replacement
    ? signalFillSchema.parse({
        ...input.replacement,
        expectedRevision: input.expectedRevision,
        clientRequestId: input.clientRequestId,
      })
    : signalFillSchema.parse(previous.payload);
  const duplicate = await getDatabase().signalFill.findUnique({ where: { requestKey } });
  if (duplicate) {
    if (
      duplicate.replacesId !== fillId ||
      duplicate.voided !== input.void ||
      JSON.stringify(duplicate.payload) !== JSON.stringify(payload)
    ) {
      throw new SignalsError('execution_unavailable');
    }
    return { id: duplicate.id, replay: task.deployment.actualAccountStatus };
  }
  if (
    previous.voided ||
    (await getDatabase().signalFill.findUnique({ where: { replacesId: fillId } }))
  ) {
    throw new SignalsError('execution_unavailable');
  }
  if (!input.void) {
    await validateFill(task, payload, fillId);
  }
  const row = await getDatabase().$transaction(async (transaction) => {
    const changed = await transaction.strategyDeployment.updateMany({
      where: { id: task.deploymentId, userId, accountInputRevision: input.expectedRevision },
      data: {
        accountInputRevision: { increment: 1 },
        dirtyFromDate: [
          task.deployment.dirtyFromDate ?? previous.tradeDate,
          previous.tradeDate,
          payload.tradeDate,
        ].sort()[0],
        replayStatus: 'pending',
        actualAccountStatus: 'pending',
      },
    });
    if (changed.count !== 1) {
      throw new SignalsError('execution_unavailable');
    }
    return transaction.signalFill.create({
      data: {
        id: ulid(),
        deploymentId: task.deploymentId,
        executionId: previous.executionId,
        requestKey,
        replacesId: fillId,
        voided: input.void,
        tradeDate: payload.tradeDate,
        payload: payload as Prisma.InputJsonValue,
      },
    });
  });

  return { id: row.id, replay: await replayActualAfterFill(task.deploymentId) };
}

/**
 * 录入或修订成交后重放实际账户，保存失败以便重试。
 *
 * Replay the actual account after fill changes and retain retryable failures.
 */
async function replayActualAfterFill(deploymentId: string): Promise<string> {
  const latest = await getDatabase().signalAccountMarketInput.findFirst({
    where: { deploymentId },
    orderBy: { tradeDate: 'desc' },
  });
  if (!latest) {
    return 'pending';
  }
  try {
    await rebuildVersionedAccount(deploymentId, 'actual', latest.tradeDate);
    const deployment = await getDatabase().strategyDeployment.findUniqueOrThrow({
      where: { id: deploymentId },
    });
    return deployment.actualAccountStatus;
  } catch {
    return 'failed';
  }
}

/**
 * 读取部署账户历史及相关执行信息，供信号对账页面展示。
 *
 * Read deployment account history and execution information for reconciliation.
 */
export async function getSignalAccountHistory(
  userId: string,
  deploymentId: string,
): Promise<SignalAccountHistory> {
  const deployment = await getDatabase().strategyDeployment.findFirst({
    where: { id: deploymentId, userId, accountingVersion: 2 },
  });
  if (!deployment) {
    throw new SignalsError('deployment_not_found');
  }
  const [states, tasks] = await Promise.all([
    getDatabase().signalAccountState.findMany({
      where: {
        deploymentId,
        OR: [
          { generation: 'baseline' },
          { kind: 'simulation', generation: deployment.simulationGeneration ?? 'baseline' },
          { kind: 'actual', generation: deployment.actualGeneration ?? 'baseline' },
        ],
      },
      orderBy: { tradeDate: 'asc' },
    }),
    getDatabase().signalExecution.findMany({
      where: { deploymentId, userId, version: 2 },
      orderBy: { execDate: 'desc' },
      include: {
        resolutions: { orderBy: { createdAt: 'desc' } },
        fills: { orderBy: { createdAt: 'asc' } },
      },
    }),
  ]);

  return {
    simulationStatus: deployment.simulationStatus,
    actualStatus: deployment.actualAccountStatus,
    revision: deployment.accountInputRevision,
    status:
      deployment.simulationStatus === 'failed' || deployment.actualAccountStatus === 'failed'
        ? 'failed'
        : deployment.simulationStatus === 'pending' || deployment.actualAccountStatus === 'pending'
          ? 'pending'
          : 'ready',
    error: deployment.simulationError ?? deployment.actualAccountError,
    modelBaseline: true,
    simulation: states
      .filter((state) => state.kind === 'simulation')
      .map((state) => signalAccountsSchema.parse(state.payload)),
    actual: states
      .filter((state) => state.kind === 'actual')
      .map((state) => signalAccountsSchema.parse(state.payload)),
    tasks: tasks
      .map((task) => ({
        maintenanceConflict: task.simulatedStatus === 'conflict',
        sourceRunId: task.signalRunId,
        actualStatus: task.actualStatus,
        actualReason: task.actualReason,
        id: task.id,
        execDate: task.execDate!,
        intent: parseTaskIntent(task.intent),
        resolutions: task.resolutions
          .filter(
            (row) =>
              row.kind !== 'simulation' ||
              simulatedSignalResolutionSchema.parse(row.payload).generation ===
                deployment.simulationGeneration,
          )
          .map((row) => ({
            id: row.id,
            kind: row.kind,
            accountRevision: row.accountRevision,
            payload:
              row.kind === 'actual'
                ? actualSignalResolutionSchema.parse(row.payload)
                : simulatedSignalResolutionSchema.parse(row.payload),
          })),
        fills: task.fills.map((row) => ({
          id: row.id,
          tradeDate: row.tradeDate,
          replacesId: row.replacesId,
          voided: row.voided,
          payload: signalFillSchema.parse(row.payload),
        })),
      }))
      .map((task) => ({ ...task, summary: summarizeSignalExecution(task) })),
  };
}

/**
 * 重试受影响账户的重放，将最新成交与冻结行情重新纳入账本。
 *
 * Retry account replay using recorded fills and frozen market inputs.
 */
export async function retrySignalAccounts(userId: string, deploymentId: string) {
  await getSignalAccountHistory(userId, deploymentId);
  const dates = await getDatabase().tradeCal.findMany({
    where: {
      exchange: 'SSE',
      isOpen: 1,
      calDate: {
        lte: new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        })
          .format(new Date())
          .replaceAll('-', ''),
      },
    },
    orderBy: { calDate: 'desc' },
  });
  const latest = dates.find((row) => isCompletedShanghaiDate(row.calDate));
  if (!latest) {
    throw new SignalsError('invalid_date');
  }
  for (const kind of ['simulation', 'actual'] as const) {
    try {
      await rebuildVersionedAccount(deploymentId, kind, latest.calDate);
    } catch {
      /* Each failed replay retains its published generation and stores its diagnostic. */
    }
  }

  return getSignalAccountHistory(userId, deploymentId);
}

/**
 * 保存执行任务的人工决策，并更新对应账户计算状态。
 *
 * Persist a manual task decision and update related accounting state.
 */
export async function setSignalTaskDecision(
  userId: string,
  executionId: string,
  input: SignalTaskDecisionInput,
) {
  const task = await ownedTask(userId, executionId);
  await getDatabase().$transaction(async (transaction) => {
    const changed = await transaction.strategyDeployment.updateMany({
      where: { id: task.deploymentId, userId, accountInputRevision: input.expectedRevision },
      data: { accountInputRevision: { increment: 1 } },
    });
    if (changed.count !== 1) {
      throw new SignalsError('execution_unavailable');
    }
    await transaction.signalExecution.update({
      where: { id: executionId },
      data: {
        actualStatus: input.status,
        actualReason: input.reason,
        ...(task.simulatedStatus === 'conflict' && input.status === 'skipped'
          ? { simulatedStatus: 'superseded' }
          : {}),
      },
    });
  });

  return getSignalAccountHistory(userId, task.deploymentId);
}

/**
 * 修订信号执行使用的市场输入并重放账户，保留可追溯版本。
 *
 * Revise execution market input and rebuild accounts with versioned provenance.
 */
export async function reviseSignalMarketInput(
  userId: string,
  deploymentId: string,
  input: SignalMarketRevisionInput,
) {
  const history = await getSignalAccountHistory(userId, deploymentId);
  const saved = await getDatabase().signalAccountMarketInput.findFirst({
    where: { deploymentId, tradeDate: input.tradeDate },
    orderBy: { revision: 'desc' },
  });
  if (
    !saved ||
    !isCompletedShanghaiDate(input.tradeDate) ||
    history.revision !== input.expectedRevision
  ) {
    throw new SignalsError('execution_unavailable');
  }
  const previous = await loadSignalMarketInput(deploymentId, input.tradeDate, []);
  const codes = [
    ...new Set(
      previous.futures.daily
        .filter((row) => row.tradeDate === input.tradeDate)
        .map((row) => row.tsCode),
    ),
  ];
  const revised = await loadSignalMarketInput(
    deploymentId,
    input.tradeDate,
    previous.codes,
    codes,
    'simulation',
    true,
  );
  await getDatabase().$transaction(async (transaction) => {
    const current = await transaction.strategyDeployment.findUniqueOrThrow({
      where: { id: deploymentId },
    });

    const changed = await transaction.strategyDeployment.updateMany({
      where: { id: deploymentId, userId, accountInputRevision: input.expectedRevision },
      data: {
        accountInputRevision: { increment: 1 },
        dirtyFromDate: [
          input.tradeDate,
          ...(current.dirtyFromDate ? [current.dirtyFromDate] : []),
        ].sort()[0],
        replayStatus: 'pending',
        simulationStatus: 'pending',
        actualAccountStatus: 'pending',
      },
    });
    if (changed.count !== 1) {
      throw new SignalsError('execution_unavailable');
    }
    await transaction.signalAccountMarketInput.create({
      data: {
        id: ulid(),
        deploymentId,
        tradeDate: input.tradeDate,
        revision: input.expectedRevision + 1,
        reason: input.reason,
        payload: revised,
        inputHash: createHash('sha256').update(JSON.stringify(revised)).digest('hex'),
      },
    });
  });

  return retrySignalAccounts(userId, deploymentId);
}
