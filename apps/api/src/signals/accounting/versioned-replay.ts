import { errorMessage } from '#infra/errors.js';
import { ulid } from 'ulid';
import type { Prisma } from '@prisma/client';
import type { BacktestConfig, SignalAccounts } from '@jixie/shared';
import { signalAccountsSchema, signalFillSchema } from '@jixie/shared/api/signals';
import { prisma } from '#infra/database/prisma.js';
import { DEFAULT_COST } from '#backtesting/cost.js';
import { completedSignalRunIds } from '../runs/state.js';
import { SignalsError } from '../errors.js';
import {
  parseTaskIntent,
  createExecutionTask,
  readVersionedBaseline,
  initializeVersionedAccounting,
} from './versioned.js';
import {
  createReplayData,
  loadSignalMarketInput,
  freezeSignalMarketInput,
} from './futures-market.js';
import { simulateAccountDay, applyActualAccountDay } from './account-day.js';
import { futureSignalReference } from '../runs/futures-projection.js';

export async function rebuildVersionedAccount(
  deploymentId: string,
  kind: 'simulation' | 'actual',
  throughDate: string,
): Promise<void> {
  let deployment = await prisma.strategyDeployment.findUniqueOrThrow({
    where: { id: deploymentId },
  });
  const runs = await prisma.signalRun.findMany({
    where: {
      deploymentId,
      resultVersion: 2,
      id: { in: await completedSignalRunIds({ deploymentId }) },
    },
    orderBy: { tradeDate: 'asc' },
  });
  for (const run of runs) {
    await initializeVersionedAccounting(run.id);
  }
  if (!runs.length) {
    return;
  }

  deployment = await prisma.strategyDeployment.findUniqueOrThrow({ where: { id: deploymentId } });
  const publishedGeneration =
    kind === 'simulation' ? deployment.simulationGeneration : deployment.actualGeneration;
  const published = publishedGeneration
    ? await prisma.signalAccountState.findFirst({
        where: { deploymentId, kind, generation: publishedGeneration },
        orderBy: { tradeDate: 'desc' },
      })
    : null;
  throughDate = published && published.tradeDate > throughDate ? published.tradeDate : throughDate;
  const revision = deployment.accountInputRevision;
  const baseline = await readVersionedBaseline(deploymentId, kind);
  let state = baseline;
  const dates = await prisma.tradeCal.findMany({
    where: { exchange: 'SSE', isOpen: 1, calDate: { gt: baseline.date, lte: throughDate } },
    orderBy: { calDate: 'asc' },
  });
  const tasks = await prisma.signalExecution.findMany({
    where: { deploymentId, version: 2 },
    orderBy: { taskKey: 'asc' },
  });
  const fills = await prisma.signalFill.findMany({
    where: { deploymentId },
    orderBy: { createdAt: 'asc' },
  });
  const superseded = new Set(fills.flatMap((fill) => (fill.replacesId ? [fill.replacesId] : [])));
  const activeFills = fills.filter((fill) => !fill.voided && !superseded.has(fill.id));
  const cost = { ...DEFAULT_COST, ...(deployment.config as unknown as BacktestConfig).cost };
  const generation = ulid();
  const pendingFillDate =
    activeFills
      .filter((fill) => fill.tradeDate > throughDate)
      .map((fill) => fill.tradeDate)
      .sort()[0] ?? null;
  try {
    for (const { calDate: date } of dates) {
      const codes = [
        ...new Set([
          ...state.positions.map((position) => position.code),
          ...baseline.positions.map((position) => position.code),
          ...tasks
            .filter((task) => task.execDate! <= date && task.assetType !== 'future')
            .map((task) => task.code),
          ...runs
            .filter((run) => run.tradeDate < date)
            .flatMap((run) =>
              signalAccountsSchema
                .parse(run.modelAccounts)
                .positions.map((position) => position.code),
            ),
        ]),
      ];
      const exits = new Set(
        tasks
          .filter((task) => task.execDate === date)
          .flatMap((task) => {
            const intent = parseTaskIntent(task.intent);
            return intent.assetType === 'future' &&
              intent.intent.kind === 'contracts' &&
              intent.intent.value === 0
              ? [intent.code]
              : [];
          }),
      );
      const futureCodes = [
        ...new Set([
          ...state.futures.positions.flatMap((position) =>
            exits.has(position.code) ? [position.actualCode] : [position.code, position.actualCode],
          ),
          ...tasks
            .filter(
              (task) =>
                task.execDate === date && task.assetType === 'future' && !exits.has(task.code),
            )
            .map((task) => task.code),
          ...activeFills
            .filter((fill) => fill.tradeDate === date)
            .flatMap((fill) =>
              tasks.find((task) => task.id === fill.executionId)?.assetType === 'future'
                ? [signalFillSchema.parse(fill.payload).actualCode]
                : [],
            ),
        ]),
      ];
      const market = await loadSignalMarketInput(
        deploymentId,
        date,
        codes,
        kind === 'simulation'
          ? futureCodes
          : state.futures.positions.map((position) => position.actualCode),
        kind,
      );
      const data = await createReplayData(market, kind === 'simulation');
      const run = runs.find((row) => row.execDate === date);
      const conditions = run ? signalAccountsSchema.parse(run.modelAccounts).conditions : undefined;
      const activeConditions = new Set(
        (conditions ?? state.conditions).map(
          (condition) => `${condition.key}:${condition.placedDate}`,
        ),
      );
      if (
        kind === 'simulation' &&
        tasks.some((task) => task.execDate === date && task.simulatedStatus === 'conflict')
      ) {
        throw new SignalsError('maintenance_conflict');
      }
      const dayTasks = tasks.filter((task) => {
        if (task.simulatedStatus === 'superseded') {
          return false;
        }
        const intent = parseTaskIntent(task.intent);
        return intent.assetType !== 'future' && intent.conditionId
          ? task.execDate! <= date &&
              !state.consumedConditions.includes(intent.conditionId) &&
              activeConditions.has(intent.conditionId)
          : task.execDate === date;
      });
      const explicitCodes = new Set(
        dayTasks.filter((task) => task.assetType === 'future').map((task) => task.code),
      );
      for (const position of state.futures.positions) {
        if (
          kind === 'actual' &&
          !data
            .snapshotFutures(market.previousDate)
            .mappings.some((mapping) => mapping.continuousCode === position.code)
        ) {
          continue;
        }
        const desired = data.futureExecutionCode(position.code, market.previousDate, date);
        if (desired === position.actualCode || explicitCodes.has(position.code)) {
          continue;
        }
        const intent = futureSignalReference({
          code: position.code,
          intent: { kind: 'roll', value: 0 },
          accounts: state,
          data,
          decisionDate: market.previousDate,
          execDate: date,
          cost,
        });
        const task = await createExecutionTask(prisma, {
          deploymentId,
          userId: deployment.userId,
          execDate: date,
          taskKey: `${deploymentId}:${date}:roll:${position.code}`,
          intent,
        });
        dayTasks.push(task);
        explicitCodes.add(position.code);
      }
      const intents = dayTasks.map((task) => parseTaskIntent(task.intent));
      const input = {
        prior: state,
        date,
        previousDate: market.previousDate,
        data,
        cost,
        intents,
        conditions,
      };
      const simulated = kind === 'simulation' ? await simulateAccountDay(input) : null;
      if (simulated) {
        state = simulated.state;
      } else {
        const manual = activeFills
          .filter((fill) => fill.tradeDate === date)
          .map((row) => {
            const task =
              tasks.find((task) => task.id === row.executionId) ??
              dayTasks.find((task) => task.id === row.executionId);
            if (!task) {
              throw new SignalsError('execution_unavailable');
            }
            return {
              intent: parseTaskIntent(task.intent),
              fill: signalFillSchema.parse(row.payload),
            };
          })
          .sort(
            (left, right) =>
              Date.parse(left.fill.executedAt) - Date.parse(right.fill.executedAt) ||
              left.fill.sequence - right.fill.sequence,
          );
        state = applyActualAccountDay(input, manual);
      }
      await freezeSignalMarketInput(deploymentId, market);
      const payload = state as Prisma.InputJsonValue;
      await prisma.$transaction(async (transaction) => {
        const current = await transaction.strategyDeployment.findUniqueOrThrow({
          where: { id: deploymentId },
        });
        if (current.accountInputRevision !== revision) {
          throw new SignalsError('execution_unavailable');
        }
        await transaction.signalAccountState.create({
          data: {
            id: ulid(),
            deploymentId,
            kind,
            generation,
            tradeDate: date,
            accountRevision: revision,
            payload,
          },
        });
        if (simulated) {
          for (const task of dayTasks) {
            const intent = parseTaskIntent(task.intent);
            const candidates =
              intent.assetType === 'future'
                ? simulated.trades.filter(
                    (trade) => trade.assetType === 'future' && trade.code === task.code,
                  )
                : simulated.cashTrace
                    .filter(
                      ({ trade, source }) =>
                        trade.code === task.code &&
                        trade.side === intent.action &&
                        (intent.source === 'conditional'
                          ? source === intent.orderType
                          : source === 'order'),
                    )
                    .map(({ trade }) => trade);
            const peers = dayTasks.filter((other) => {
              const otherIntent = parseTaskIntent(other.intent);
              return (
                otherIntent.assetType !== 'future' &&
                intent.assetType !== 'future' &&
                otherIntent.code === intent.code &&
                otherIntent.action === intent.action &&
                (otherIntent.source === 'conditional') === (intent.source === 'conditional')
              );
            });
            const requested = peers.reduce((sum, other) => sum + (other.requestedShares ?? 0), 0);
            const fraction =
              intent.assetType === 'future' || intent.source === 'conditional' || requested === 0
                ? 1
                : intent.shares / requested;
            const trades = candidates.map((trade) => ({
              ...trade,
              shares: trade.shares * fraction,
              realShares: trade.realShares * fraction,
              amount: trade.amount * fraction,
              fee: trade.fee * fraction,
              slippageCost: trade.slippageCost * fraction,
            }));
            await transaction.signalResolution.create({
              data: {
                id: ulid(),
                deploymentId,
                executionId: task.id,
                kind,
                requestKey: `${generation}:${date}:${task.id}`,
                accountRevision: revision,
                payload: {
                  generation,
                  status: trades.length ? 'filled' : 'no_action',
                  priceBasis: 'daily_simulation',
                  date,
                  mappingDate: market.previousDate,
                  trades: trades.map((trade) => ({ ...trade })),
                },
              },
            });
          }
        }
      });
    }
    await prisma.$transaction(async (transaction) => {
      const changed = await transaction.strategyDeployment.updateMany({
        where: {
          id: deploymentId,
          accountInputRevision: revision,
          ...(kind === 'simulation'
            ? { simulationGeneration: publishedGeneration }
            : { actualGeneration: publishedGeneration }),
        },
        data: {
          ...(kind === 'simulation'
            ? {
                simulationGeneration: dates.length ? generation : 'baseline',
                simulationStatus: 'ready',
                simulationError: null,
              }
            : {
                actualGeneration: dates.length ? generation : 'baseline',
                dirtyFromDate: pendingFillDate,
                actualAccountStatus: pendingFillDate ? 'pending' : 'ready',
                actualAccountError: null,
              }),
          replayStatus: 'ready',
          replayError: null,
        },
      });
      if (changed.count !== 1) {
        throw new SignalsError('execution_unavailable');
      }
    });
  } catch (error) {
    await prisma.strategyDeployment.updateMany({
      where: {
        id: deploymentId,
        accountInputRevision: revision,
        ...(kind === 'simulation'
          ? { simulationGeneration: publishedGeneration }
          : { actualGeneration: publishedGeneration }),
      },
      data: {
        replayStatus: 'failed',
        replayError: errorMessage(error, deployment.locale === 'en' ? 'en' : 'zh'),
        ...(kind === 'simulation'
          ? {
              simulationStatus: 'failed',
              simulationError: errorMessage(error, deployment.locale === 'en' ? 'en' : 'zh'),
            }
          : {
              actualAccountStatus: 'failed',
              actualAccountError: errorMessage(error, deployment.locale === 'en' ? 'en' : 'zh'),
            }),
      },
    });
    throw error;
  }
}

export async function readPublishedAccount(
  deploymentId: string,
  kind: 'simulation' | 'actual',
): Promise<SignalAccounts> {
  const deployment = await prisma.strategyDeployment.findUniqueOrThrow({
    where: { id: deploymentId },
  });
  const generation =
    kind === 'simulation' ? deployment.simulationGeneration : deployment.actualGeneration;
  const row = generation
    ? await prisma.signalAccountState.findFirst({
        where: { deploymentId, kind, generation },
        orderBy: { tradeDate: 'desc' },
      })
    : null;
  if (!row) {
    throw new SignalsError('execution_unavailable');
  }

  return signalAccountsSchema.parse(row.payload);
}
