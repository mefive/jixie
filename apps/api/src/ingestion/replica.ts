import { sourceExecution } from '#market/synchronization/execution.js';
import pkg, { type IngestionRun, type Prisma } from '@prisma/client';
import type { IngestionExecutionSummary } from '@jixie/shared/api/ingestion';
import { randomUUID } from 'node:crypto';
import { ulid } from 'ulid';
import { getDatabase } from '#infra/database/prisma.js';
import { withMaintenanceLock, withMarketPublication } from '#infra/coordination/market-access.js';
import { isObservationDate } from '#market/synchronization/date.js';
import { fingerprint } from '#market/synchronization/rows.js';
import { collectInReplica } from './ingest.js';
import { readRunIssueState } from './issue-state.js';
import { readIssueHandling } from './resolutions.js';
import { installReplicaJournal, publishMarketChanges } from './replica-changes.js';
import {
  candidateFilename,
  cleanupCandidate,
  createCandidateFile,
  hasCandidateFile,
  withCandidate,
} from './replica-files.js';
import type { IngestionInput, IngestionRetryInput } from './schema.js';
import { ingestionExecutionSchema } from './schema.js';
import { IngestionError } from './errors.js';

const transactionOptions = { timeout: 120_000 };
const editable = ['awaiting_repair', 'awaiting_publish'];

async function baseline(database: Prisma.TransactionClient) {
  const revision = await database.marketDataState.findUnique({ where: { key: 'global' } });
  const selection = await database.ingestionSelection.findMany({ orderBy: { assetType: 'asc' } });
  const schema = await database.$queryRaw`
    SELECT name, type, sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY name
  `;

  return fingerprint({ revision, selection, schema });
}

async function claim(runId: string, expected: string[], phase: string): Promise<string> {
  const operation = randomUUID();
  const { count } = await getDatabase().ingestionRun.updateMany({
    where: { id: runId, activeReplica: 1, replicaPhase: { in: expected }, replicaOperation: null },
    data: { replicaPhase: phase, replicaOperation: operation },
  });
  if (count !== 1) {
    throw new IngestionError('candidate_state_conflict');
  }

  return operation;
}

async function finishOperation(
  runId: string,
  operation: string,
  data: Prisma.IngestionRunUpdateManyMutationInput,
) {
  const { count } = await getDatabase().ingestionRun.updateMany({
    where: { id: runId, activeReplica: 1, replicaOperation: operation },
    data: { ...data, replicaOperation: null },
  });
  if (count !== 1) {
    throw new IngestionError('candidate_state_conflict');
  }
}

async function reviewCandidate(runId: string, { includeBatchTimings = false } = {}) {
  const database = getDatabase();
  return database.$transaction(async (transaction) => {
    const state = await readRunIssueState(transaction, runId);
    const market = await transaction.marketDataState.findUnique({ where: { key: 'global' } });
    const decisions = [];
    let pending = 0;
    for (const issue of state.active) {
      const handling = await readIssueHandling(transaction, issue);
      if (handling.status === 'pending' || handling.status === 'review') {
        pending++;
      }
      decisions.push({ id: issue.issue.id, handling, version: issue.resolution?.updatedAt });
    }
    const phase = ['completed', 'completed_with_issues'].includes(state.run.status)
      ? pending
        ? 'awaiting_repair'
        : 'awaiting_publish'
      : 'interrupted';
    const timings = includeBatchTimings ? await readRunTimings(transaction, runId) : {};

    return {
      phase,
      pending,
      run: state.run,
      candidateVersion: fingerprint({ runId, market, decisions, finishedAt: state.run.finishedAt }),
      timings,
    };
  }, transactionOptions);
}

/** 主库保留活跃名额，副本持有批次数据和采集游标。 / Reserve the active slot in main and keep batch data and cursors in the candidate. */
export async function ingestCandidate(
  input: IngestionInput,
  explicitTarget: boolean,
  retryRunId?: string,
) {
  if (!isObservationDate(input.targetDate)) {
    throw new IngestionError('invalid_target_date');
  }
  const main = getDatabase();
  let run = await main.ingestionRun.findUnique({ where: { activeReplica: 1 } });
  const upgradeStatements = Boolean(retryRunId && run?.replicaPhase === 'interrupted');
  if (retryRunId && run?.id !== retryRunId) {
    throw new IngestionError('candidate_state_conflict');
  }
  const operation = randomUUID();
  if (run) {
    if (explicitTarget && input.targetDate !== run.targetDate) {
      throw new IngestionError('candidate_state_conflict');
    }
    const retryRepair = retryRunId && run.replicaPhase === 'awaiting_repair';
    if (run.replicaPhase !== 'interrupted' && !retryRepair) {
      if (retryRunId) {
        throw new IngestionError('candidate_state_conflict');
      }
      return {
        mode: 'existing_candidate',
        runId: run.id,
        targetDate: run.targetDate,
        phase: run.replicaPhase,
      };
    }
    const token = await claim(
      run.id,
      retryRepair ? ['awaiting_repair'] : ['interrupted'],
      'running',
    );
    run = { ...run, replicaOperation: token };
  } else {
    try {
      run = await main.$transaction(async (transaction) =>
        transaction.ingestionRun.create({
          data: {
            id: ulid(),
            targetDate: input.targetDate,
            trigger: input.trigger ?? 'manual',
            scopeSnapshot: {},
            status: 'running',
            startedAt: input.clock?.() ?? new Date(),
            activeReplica: 1,
            replicaPhase: 'running',
            replicaOperation: operation,
            replicaBaseline: await baseline(transaction),
          },
        }),
      );
    } catch (error) {
      if (error instanceof pkg.Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new IngestionError('candidate_state_conflict');
      }
      throw error;
    }
  }
  const { id, targetDate, replicaOperation, replicaReadyAt, replicaBaseline } = run;
  const token = replicaOperation!;
  try {
    const path = candidateFilename(id);
    if (!(await hasCandidateFile(path))) {
      if (replicaReadyAt) {
        throw new IngestionError('candidate_missing');
      }
      if ((await baseline(main)) !== replicaBaseline) {
        throw new IngestionError('candidate_baseline_changed');
      }
      await createCandidateFile(path, input.signal);
    }
    if (!replicaReadyAt) {
      await withCandidate(id, async (candidate) => {
        const local = await candidate.ingestionRun.findUniqueOrThrow({ where: { id } });
        if (local.replicaReadyAt) {
          return;
        }
        if ((await baseline(candidate)) !== replicaBaseline) {
          throw new IngestionError('candidate_baseline_changed');
        }
        await candidate.$transaction(async (transaction) => {
          await installReplicaJournal(transaction);
          await transaction.ingestionRun.update({
            where: { id },
            data: { replicaReadyAt: new Date() },
          });
          await transaction.marketDataState.upsert({
            where: { key: 'global' },
            create: { key: 'global' },
            update: {},
          });
        }, transactionOptions);
      });
      const { count } = await main.ingestionRun.updateMany({
        where: { id, replicaOperation: token },
        data: { replicaReadyAt: new Date() },
      });
      if (count !== 1) {
        throw new IngestionError('candidate_state_conflict');
      }
    }

    const result = await withCandidate(id, async () => {
      const execution = await collectInReplica({ ...input, targetDate }, id, upgradeStatements);
      const review = await reviewCandidate(id);

      return { execution, review };
    });
    await finishOperation(id, token, {
      status: result.execution.status,
      replicaPhase: result.review.phase,
      finishedAt: result.review.run.finishedAt,
      summary: result.review.run.summary as Prisma.InputJsonValue,
    });

    return {
      mode: 'candidate',
      runId: id,
      targetDate,
      phase: result.review.phase,
      candidateVersion: result.review.candidateVersion,
      pending: result.review.pending,
      execution: result.execution,
    };
  } catch (error) {
    await finishOperation(id, token, { status: 'interrupted', replicaPhase: 'interrupted' });
    throw error;
  }
}

/**
 * 显式重试同一副本，保留固定计划和所有成功批次。
 *
 * Explicitly retry the same candidate while retaining its frozen plan and successful batches.
 */
export async function retryCandidate(runId: string, input: IngestionRetryInput) {
  const run = await getDatabase().ingestionRun.findUnique({ where: { id: runId } });
  if (!run?.activeReplica || !['awaiting_repair', 'interrupted'].includes(run.replicaPhase ?? '')) {
    throw new IngestionError('candidate_state_conflict');
  }

  return ingestCandidate({ ...input, targetDate: run.targetDate }, true, runId);
}

async function readRunTimings(database: Prisma.TransactionClient, runId: string) {
  const { startedAt, finishedAt, batches } = await database.ingestionRun.findUniqueOrThrow({
    where: { id: runId },
    select: {
      startedAt: true,
      finishedAt: true,
      batches: {
        select: {
          id: true,
          request: true,
          dataset: true,
          scope: true,
          period: true,
          api: true,
          rangeStart: true,
          rangeEnd: true,
          status: true,
          startedAt: true,
          finishedAt: true,
        },
        orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
      },
    },
  });

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt?.toISOString() ?? null,
    batches: batches.map(({ request, ...batch }) => ({
      ...batch,
      execution: sourceExecution(request),
      elapsedMs: batch.finishedAt ? batch.finishedAt.getTime() - batch.startedAt.getTime() : null,
    })),
  };
}

type CandidateInspection = Partial<Awaited<ReturnType<typeof readRunTimings>>> & {
  runId: string;
  targetDate: string;
  phase: string | null;
  status: string;
  pending?: number;
  candidateVersion?: string;
  execution?: IngestionExecutionSummary | null;
  publishedRevision?: number | null;
  publishedAt?: Date | null;
  rejectionReason?: string | null;
};

export async function inspectCandidate(
  runId: string,
  { includeBatchTimings = false } = {},
): Promise<CandidateInspection> {
  const database = getDatabase();
  const run = await database.ingestionRun.findUnique({ where: { id: runId } });
  if (!run) {
    throw new IngestionError('candidate_missing');
  }

  const hasReadyReplica = Boolean(run.activeReplica && run.replicaReadyAt);
  if (hasReadyReplica && editable.includes(run.replicaPhase ?? '')) {
    const review = await withCandidate(runId, () =>
      reviewCandidate(runId, { includeBatchTimings }),
    );
    const execution = ingestionExecutionSchema.safeParse(review.run.summary);

    return {
      runId,
      targetDate: run.targetDate,
      phase: run.replicaPhase,
      pending: review.pending,
      candidateVersion: review.candidateVersion,
      status: review.run.status,
      finishedAt: review.run.finishedAt?.toISOString() ?? null,
      execution: execution.success ? execution.data : null,
      ...review.timings,
    };
  }

  let timings;
  if (includeBatchTimings) {
    timings = hasReadyReplica
      ? await withCandidate(runId, (candidate) => readRunTimings(candidate, runId))
      : await readRunTimings(database, runId);
  }

  return {
    runId,
    targetDate: run.targetDate,
    phase: run.replicaPhase,
    status: run.status,
    publishedRevision: run.publishedRevision,
    publishedAt: run.publishedAt,
    rejectionReason: run.rejectionReason,
    ...timings,
  };
}

export async function repairCandidate<Result>(
  runId: string,
  apply: boolean,
  operation: () => Promise<Result>,
) {
  const run = await getDatabase().ingestionRun.findUniqueOrThrow({ where: { id: runId } });
  if (!run.activeReplica || !editable.includes(run.replicaPhase ?? '')) {
    throw new IngestionError('candidate_state_conflict');
  }
  if (!apply) {
    return withCandidate(runId, operation);
  }
  const token = await claim(runId, editable, 'repairing');
  try {
    const result = await withCandidate(runId, async () => {
      const value = await operation();
      const review = await reviewCandidate(runId);

      return { value, review };
    });
    await finishOperation(runId, token, { replicaPhase: result.review.phase });

    return result.value;
  } catch (error) {
    // 修复事务可能已经提交，重读副本后再释放执行权。 / Re-read candidate after a potentially committed repair.
    const review = await withCandidate(runId, () => reviewCandidate(runId));
    await finishOperation(runId, token, { replicaPhase: review.phase });
    throw error;
  }
}

const inputJson = (value: Prisma.JsonValue) =>
  value === null ? pkg.Prisma.DbNull : (value as Prisma.InputJsonValue);

async function publishDiagnostics(
  main: Prisma.TransactionClient,
  candidate: Prisma.TransactionClient,
  run: Pick<IngestionRun, 'id'>,
  revision: number,
) {
  const batches = await candidate.ingestionBatch.findMany({ where: { runId: run.id } });
  for (let offset = 0; offset < batches.length; offset += 250) {
    await main.ingestionBatch.createMany({
      data: batches
        .slice(offset, offset + 250)
        .map((row) => ({ ...row, request: row.request as Prisma.InputJsonValue })),
    });
  }
  const issues = await candidate.ingestionIssue.findMany({
    where: { runId: run.id },
    include: { resolution: true },
  });
  for (const { resolution, ...issue } of issues) {
    await main.ingestionIssue.create({
      data: {
        ...issue,
        payload: inputJson(issue.payload),
        businessKey: inputJson(issue.businessKey),
      },
    });
    if (resolution) {
      await main.ingestionIssueResolution.create({
        data: {
          ...resolution,
          evidence: inputJson(resolution.evidence),
          before: inputJson(resolution.before),
          after: inputJson(resolution.after),
          history: resolution.history as Prisma.InputJsonValue,
          marketRevision: resolution.marketRevision === null ? null : revision,
        },
      });
    }
  }
}

export async function acceptCandidate(
  runId: string,
  expectedVersion: string,
  signal?: AbortSignal,
) {
  const main = getDatabase();
  const run = await main.ingestionRun.findUnique({ where: { id: runId } });
  if (!run) {
    throw new IngestionError('candidate_missing');
  }
  if (run.publishedAt) {
    return {
      mode: 'already_published' as const,
      runId,
      revision: run.publishedRevision,
      cleaned: await cleanupCandidate(runId),
    };
  }
  const token = await claim(runId, ['awaiting_publish'], 'publishing');
  try {
    const result = await withCandidate(runId, async (candidate) => {
      const review = await reviewCandidate(runId);
      if (review.phase !== 'awaiting_publish' || review.candidateVersion !== expectedVersion) {
        throw new IngestionError('candidate_state_conflict');
      }

      return withMaintenanceLock(() =>
        withMarketPublication(() =>
          main.$transaction(async (transaction) => {
            signal?.throwIfAborted();
            const current = await transaction.ingestionRun.findUniqueOrThrow({
              where: { id: runId },
            });
            if (
              current.replicaOperation !== token ||
              (await baseline(transaction)) !== run.replicaBaseline
            ) {
              throw new IngestionError('candidate_baseline_changed');
            }
            const changes = await publishMarketChanges(candidate, transaction, signal);
            const state = await transaction.marketDataState.upsert({
              where: { key: 'global' },
              create: { key: 'global', revision: changes ? 1 : 0 },
              update: changes ? { revision: { increment: 1 } } : {},
            });
            await publishDiagnostics(transaction, candidate, review.run, state.revision);
            signal?.throwIfAborted();
            await transaction.ingestionRun.update({
              where: { id: runId, replicaOperation: token },
              data: {
                status: review.run.status,
                summary: inputJson(review.run.summary),
                finishedAt: review.run.finishedAt,
                scopeSnapshot: review.run.scopeSnapshot as Prisma.InputJsonValue,
                activeReplica: null,
                replicaOperation: null,
                replicaPhase: 'published',
                publishedAt: new Date(),
                publishedRevision: state.revision,
              },
            });

            return { mode: 'published' as const, runId, changes, revision: state.revision };
          }, transactionOptions),
        ),
      );
    });

    return { ...result, cleaned: await cleanupCandidate(runId) };
  } catch (error) {
    const current = await main.ingestionRun.findUniqueOrThrow({ where: { id: runId } });
    if (!current.publishedAt) {
      await finishOperation(runId, token, { replicaPhase: 'awaiting_publish' });
    }
    throw error;
  }
}

export async function rejectCandidate(runId: string, reason: string) {
  const database = getDatabase();
  const { count } = await database.ingestionRun.updateMany({
    where: {
      id: runId,
      activeReplica: 1,
      replicaOperation: null,
      replicaPhase: { in: [...editable, 'interrupted'] },
    },
    data: {
      activeReplica: null,
      replicaPhase: 'rejected',
      rejectionReason: reason,
      finishedAt: new Date(),
    },
  });
  if (count !== 1) {
    throw new IngestionError('candidate_state_conflict');
  }

  return { mode: 'rejected', runId, cleaned: await cleanupCandidate(runId) };
}

/** 仅在维护者确认旧命令已退出后恢复持久化执行权。 / Recover a persisted claim only after the operator confirms its owner stopped. */
export async function recoverCandidate(runId: string) {
  const run = await getDatabase().ingestionRun.findUniqueOrThrow({ where: { id: runId } });
  if (run.publishedAt) {
    return { runId, phase: 'published', cleaned: await cleanupCandidate(runId) };
  }
  if (
    !run.replicaOperation ||
    !['running', 'repairing', 'publishing'].includes(run.replicaPhase ?? '')
  ) {
    throw new IngestionError('candidate_state_conflict');
  }
  const review =
    run.replicaReadyAt && (await hasCandidateFile(candidateFilename(runId)))
      ? await withCandidate(runId, () => reviewCandidate(runId))
      : null;
  const phase = review?.phase ?? 'interrupted';
  await finishOperation(runId, run.replicaOperation, {
    replicaPhase: phase,
    status: review?.run.status ?? 'interrupted',
    ...(review
      ? { finishedAt: review.run.finishedAt, summary: inputJson(review.run.summary) }
      : {}),
  });

  return { runId, phase };
}
