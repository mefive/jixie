import type { Prisma } from '@prisma/client';
import type { ResearchEmbeddedErrorCodeV1 } from '@jixie/shared';
import type { EmbeddedExecutionResult } from './execute.js';

export async function completeEmbeddedRun(
  transaction: Prisma.TransactionClient,
  result: EmbeddedExecutionResult,
) {
  const run = await transaction.researchExecution.findFirst({
    where: { id: result.runId, status: 'running' },
    include: { embeddedVersion: true, cellExecutions: true },
  });
  if (
    !run?.embeddedVersion ||
    run.cellExecutions.length !== 1 ||
    run.cellExecutions[0].id !== result.cellExecutionId
  ) {
    throw new Error('Embedded completion does not match its active version and cell');
  }
  const finishedAt = new Date();
  if (result.status === 'success') {
    const incomplete = await transaction.researchExecutionInput.count({
      where: { executionId: run.id, status: { in: ['loading', 'interrupted'] } },
    });
    if (
      incomplete ||
      !run.environmentSnapshot ||
      !result.environmentFingerprint ||
      run.environmentFingerprint !== result.environmentFingerprint
    ) {
      throw new Error(
        'Embedded execution cannot succeed with incomplete input or environment evidence',
      );
    }
  }
  if (result.materialized.artifacts.length) {
    await transaction.researchArtifact.createMany({ data: result.materialized.artifacts });
  }
  await transaction.researchCellExecution.update({
    where: { id: result.cellExecutionId, status: 'running' },
    data: {
      status: result.status,
      output: result.materialized.outputs as unknown as Prisma.InputJsonValue,
      error: result.error,
      definitions: result.definitions,
      references: result.references,
      environmentFingerprint:
        result.environmentFingerprint ?? run.environmentFingerprint ?? 'unavailable',
      finishedAt,
    },
  });
  await transaction.researchExecution.update({
    where: { id: run.id, status: 'running' },
    data: {
      status: result.status,
      errorCode: result.errorCode,
      error: result.error,
      environmentFingerprint: result.environmentFingerprint ?? run.environmentFingerprint,
      executedCellIds: [run.cellExecutions[0].sourceCellId!],
      finishedAt,
    },
  });
  if (result.status === 'success') {
    if (run.embeddedVersion.revision !== run.contentRevision) {
      throw new Error('Embedded source changed during execution');
    }
    await transaction.researchEmbeddedAnalysisVersion.updateMany({
      where: { id: run.embeddedVersion.id, frozenAt: null, revision: run.contentRevision },
      data: { frozenAt: finishedAt },
    });
  } else {
    await interruptPendingInputs(
      transaction,
      run.id,
      result.error ?? 'Execution failed',
      finishedAt,
    );
  }
  const released = await transaction.researchEmbeddedAnalysis.updateMany({
    where: { id: run.embeddedVersion.analysisId, activeRunId: run.id },
    data: { activeRunId: null },
  });
  if (released.count !== 1) {
    throw new Error('Embedded completion lost its active run claim');
  }
}

export async function failEmbeddedRun(
  transaction: Prisma.TransactionClient,
  runId: string,
  code: ResearchEmbeddedErrorCodeV1,
  error: string,
  status: 'error' | 'cancelled' = 'error',
) {
  const run = await transaction.researchExecution.findFirst({
    where: { id: runId, status: { in: ['queued', 'running'] }, embeddedVersion: { isNot: null } },
    select: { embeddedVersion: { select: { analysisId: true } } },
  });
  if (!run?.embeddedVersion) {
    return;
  }
  const finishedAt = new Date();
  const detail = error.slice(0, 8_000);
  const changed = await transaction.researchExecution.updateMany({
    where: { id: runId, status: { in: ['queued', 'running'] } },
    data: { status, errorCode: code, error: detail, finishedAt },
  });
  if (changed.count !== 1) {
    return;
  }
  await transaction.researchCellExecution.updateMany({
    where: { researchExecutionId: runId, status: { in: ['queued', 'running'] } },
    data: { status, error: detail, finishedAt },
  });
  await interruptPendingInputs(transaction, runId, detail, finishedAt);
  await transaction.researchEmbeddedAnalysis.updateMany({
    where: { id: run.embeddedVersion.analysisId, activeRunId: runId },
    data: { activeRunId: null },
  });
}

async function interruptPendingInputs(
  transaction: Prisma.TransactionClient,
  runId: string,
  error: string,
  finishedAt: Date,
) {
  await transaction.researchExecutionInput.updateMany({
    where: { executionId: runId, status: 'loading' },
    data: { status: 'interrupted', error, capturedAt: finishedAt },
  });
}
