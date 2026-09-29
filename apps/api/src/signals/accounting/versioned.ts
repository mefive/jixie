import { ulid } from 'ulid';
import type { Prisma } from '@prisma/client';
import type { FutureSignalItem, SignalAccounts, SignalItem } from '@jixie/shared';
import { futureSignalSchema, signalAccountsSchema } from '@jixie/shared/api/signals';
import { prisma } from '#infra/database/prisma.js';
import { signalItemSchema } from '../runs/result-schema.js';
import { signalRunState, currentSignalJob } from '../runs/state.js';
import { SignalsError } from '../errors.js';

export function parseTaskIntent(value: unknown): SignalItem | FutureSignalItem {
  if (
    typeof value === 'object' &&
    value !== null &&
    'assetType' in value &&
    value.assetType === 'future'
  ) {
    return futureSignalSchema.parse(value);
  }

  return signalItemSchema.parse(value);
}

export async function initializeVersionedAccounting(runId: string): Promise<void> {
  const row = await prisma.signalRun.findUnique({
    where: { id: runId },
    include: { jobs: currentSignalJob },
  });
  if (
    !row ||
    row.resultVersion !== 2 ||
    row.accountingInitialized ||
    signalRunState(row).status !== 'done'
  ) {
    return;
  }
  const accounts = signalAccountsSchema.parse(row.modelAccounts);
  const intents = [
    ...signalItemSchema.array().parse(row.signals),
    ...futureSignalSchema.array().parse(row.intentSnapshot),
  ];
  await prisma.$transaction(async (transaction) => {
    const current = await transaction.job.findFirst({
      where: { signalRunId: runId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (current && (current.id !== row.jobs[0]?.id || current.status !== 'done')) {
      return;
    }

    for (const [index, intent] of intents.entries()) {
      const taskKey =
        intent.assetType !== 'future' && intent.conditionId
          ? `${row.deploymentId}:condition:${intent.conditionId}`
          : `${row.id}:${index}`;
      if (intent.assetType === 'future') {
        const maintenance = await transaction.signalExecution.findFirst({
          where: {
            deploymentId: row.deploymentId,
            execDate: row.execDate,
            code: intent.code,
            version: 2,
            signalRunId: null,
            source: 'roll',
          },
          include: { fills: true },
        });
        if (maintenance) {
          if (intent.intent.kind === 'roll') {
            continue;
          }
          await transaction.signalExecution.update({
            where: { id: maintenance.id },
            data: {
              simulatedStatus: maintenance.fills.length ? 'conflict' : 'superseded',
              ...(maintenance.fills.length ? {} : { actualStatus: 'skipped' }),
            },
          });
        }
      }
      await createExecutionTask(transaction, {
        deploymentId: row.deploymentId,
        userId: row.userId,
        execDate: row.execDate,
        signalRunId: row.id,
        signalIndex: index,
        taskKey,
        intent,
      });
    }
    const initialized = await transaction.signalRun.updateMany({
      where: { id: runId, accountingInitialized: false },
      data: { accountingInitialized: true },
    });
    if (initialized.count) {
      await transaction.strategyDeployment.update({
        where: { id: row.deploymentId },
        data: { accountInputRevision: { increment: 1 } },
      });
    }
    const baseline = await transaction.signalAccountState.findFirst({
      where: { deploymentId: row.deploymentId, generation: 'baseline' },
    });
    if (!baseline) {
      for (const kind of ['simulation', 'actual']) {
        await transaction.signalAccountState.create({
          data: {
            id: ulid(),
            deploymentId: row.deploymentId,
            kind,
            generation: 'baseline',
            tradeDate: row.tradeDate,
            accountRevision: 0,
            payload: accounts as Prisma.InputJsonValue,
          },
        });
      }
      await transaction.strategyDeployment.update({
        where: { id: row.deploymentId },
        data: {
          simulationGeneration: 'baseline',
          actualGeneration: 'baseline',
          replayStatus: 'ready',
          simulationStatus: 'ready',
          actualAccountStatus: 'ready',
        },
      });
    }
  });
}

export async function createExecutionTask(
  transaction: Prisma.TransactionClient,
  input: {
    deploymentId: string;
    userId: string;
    execDate: string;
    taskKey: string;
    signalRunId?: string;
    signalIndex?: number;
    intent: SignalItem | FutureSignalItem;
  },
) {
  const { intent } = input;
  const future = intent.assetType === 'future';
  return transaction.signalExecution.upsert({
    where: { taskKey: input.taskKey },
    update: {},
    create: {
      id: ulid(),
      userId: input.userId,
      deploymentId: input.deploymentId,
      execDate: input.execDate,
      taskKey: input.taskKey,
      signalRunId: input.signalRunId,
      signalIndex: input.signalIndex,
      version: 2,
      intent: intent as Prisma.InputJsonValue,
      code: intent.code,
      name: intent.name,
      assetType: intent.assetType,
      action: future ? (intent.referenceTargetContracts >= 0 ? 'buy' : 'sell') : intent.action,
      requestedShares: future ? null : intent.shares,
      refPrice: future ? intent.referencePrice : intent.refPrice,
      refAmount: future ? Math.abs(intent.referenceNotional) : intent.refAmount,
      source: future ? intent.intent.kind : intent.source,
    },
  });
}

export async function readVersionedBaseline(
  deploymentId: string,
  kind: string,
): Promise<SignalAccounts> {
  const row = await prisma.signalAccountState.findFirst({
    where: { deploymentId, kind, generation: 'baseline' },
    orderBy: { tradeDate: 'asc' },
  });
  if (!row) {
    throw new SignalsError('execution_unavailable');
  }

  return signalAccountsSchema.parse(row.payload);
}
