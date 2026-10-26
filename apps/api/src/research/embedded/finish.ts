import pkg from '@prisma/client';
import type { Prisma } from '@prisma/client';

import type { ResearchEmbeddedErrorCodeV1 } from '@jixie/shared';
import type { EmbeddedExecutionResult } from './execute.js';

const { Prisma: PrismaValues } = pkg;

/**
 * 原子保存当前运行输出并释放占用，终态清除 Job 中的临时执行输入。
 *
 * Persist current run output, release its claim and clear temporary Job input at completion.
 */
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
      finishedAt,
    },
  });
  await transaction.researchExecution.update({
    where: { id: run.id, status: 'running' },
    data: {
      status: result.status,
      errorCode: result.errorCode,
      error: result.error,
      finishedAt,
    },
  });
  await transaction.researchCell.updateMany({
    where: { documentId: run.documentId, revision: run.contentRevision },
    data: {
      status: result.status,
      output: result.materialized.outputs as unknown as Prisma.InputJsonValue,
      definitions: result.definitions,
      references: result.references,
      lastExecutedRevision: run.contentRevision,
      lastExecutedAt: finishedAt,
    },
  });
  await transaction.job.updateMany({
    where: { researchExecutionId: run.id },
    data: { payload: PrismaValues.DbNull },
  });
  const released = await transaction.researchEmbeddedAnalysis.updateMany({
    where: { id: run.embeddedVersion.analysisId, activeRunId: run.id },
    data: { activeRunId: null },
  });
  if (released.count !== 1) {
    throw new Error('Embedded completion lost its active run claim');
  }
}

/**
 * 保存嵌入式运行失败或取消结果，保留可查询诊断。
 *
 * Persist embedded failure or cancellation with queryable diagnostics.
 */
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
  await transaction.job.updateMany({
    where: { researchExecutionId: runId },
    data: { payload: PrismaValues.DbNull },
  });
  await transaction.researchEmbeddedAnalysis.updateMany({
    where: { id: run.embeddedVersion.analysisId, activeRunId: runId },
    data: { activeRunId: null },
  });
}
