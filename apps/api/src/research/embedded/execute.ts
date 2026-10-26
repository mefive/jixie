import { researchSandboxPool } from '../sandbox/research-sandbox-pool.js';
import { getDatabase } from '#infra/database/prisma.js';
import { type ResearchCellOutputBlockV1, type ResearchEmbeddedErrorCodeV1 } from '@jixie/shared';
import { ResearchError, ResearchPythonExecutionError } from '../errors.js';
import {
  materializeResearchOutputArtifacts,
  type MaterializedResearchOutputs,
} from '../outputs/artifacts.js';

import { RESEARCH_EMBEDDED_LIMITS } from '@jixie/shared';
import type { ResearchEmbeddedAnalysisJobPayload } from './job-payload.js';

const activeControllers = new Map<string, AbortController>();
export function abortEmbeddedRuntime(runId: string) {
  activeControllers.get(runId)?.abort(new ResearchError('embedded_cancelled'));
}

/**
 * 返回嵌入式运行的终态与输出。
 *
 * Return embedded execution status and outputs.
 */
export interface EmbeddedExecutionResult {
  runId: string;
  cellExecutionId: string;
  status: 'success' | 'error';
  errorCode: ResearchEmbeddedErrorCodeV1 | null;
  error: string | null;
  definitions: string[];
  references: string[];
  materialized: MaterializedResearchOutputs;
}

/**
 * 执行 Job 中的临时代码和参数，返回当前输出并在结束后关闭会话。
 *
 * Execute temporary Job code and parameters, return current output and close the session at completion.
 */
export async function executeEmbeddedRun(
  runId: string,
  userId: string,
  input: ResearchEmbeddedAnalysisJobPayload,
): Promise<EmbeddedExecutionResult> {
  const controller = new AbortController();
  activeControllers.set(runId, controller);
  const { signal } = controller;
  let documentId: string | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  let abortListener: (() => void) | undefined;
  try {
    const run = await getDatabase().$transaction(async (transaction) => {
      const row = await transaction.researchExecution.findFirst({
        where: {
          id: runId,
          status: 'queued',
          document: { userId },
          embeddedVersion: { isNot: null },
          job: { status: 'running' },
        },
        include: { cellExecutions: true },
      });
      if (!row || row.cellExecutions.length !== 1) {
        throw new ResearchError('embedded_cancelled');
      }
      await transaction.researchExecution.update({
        where: { id: runId, status: 'queued' },
        data: { status: 'running', startedAt: new Date() },
      });
      await transaction.researchCellExecution.updateMany({
        where: { researchExecutionId: runId, status: 'queued' },
        data: { status: 'running', startedAt: new Date() },
      });
      return row;
    });
    if (run.contentRevision !== input.revision) {
      throw new Error('Embedded input revision does not match the queued run');
    }
    documentId = run.documentId;
    const cell = run.cellExecutions[0];
    const limits = RESEARCH_EMBEDDED_LIMITS;
    researchSandboxPool.close(documentId);
    timeout = setTimeout(
      () => controller.abort(new ResearchError('embedded_timeout')),
      limits.executionMilliseconds,
    );
    timeout.unref();
    // Cancellation can be submitted to another API process; the persisted terminal state wins.
    let polling = false;
    poll = setInterval(() => {
      if (polling || signal.aborted) {
        return;
      }
      polling = true;
      void getDatabase()
        .researchExecution.findUnique({ where: { id: runId }, select: { status: true } })
        .then((current) => {
          if (!signal.aborted && current?.status !== 'running') {
            controller.abort(new ResearchError('embedded_cancelled'));
          }
        })
        .catch((error: unknown) => controller.abort(error))
        .finally(() => {
          polling = false;
        });
    }, 500);
    poll.unref();
    const aborted = new Promise<never>((_, reject) => {
      abortListener = () => reject(signal.reason);
      signal.addEventListener('abort', abortListener, { once: true });
      if (signal.aborted) {
        abortListener();
      }
    });
    let outputs: ResearchCellOutputBlockV1[] = [];
    let definitions: string[] = [];
    let references: string[] = [];
    let errorCode: ResearchEmbeddedErrorCodeV1 | null = null;
    let error: string | null = null;
    try {
      const executed = await Promise.race([
        researchSandboxPool.withSandbox(
          documentId,
          (sandbox) =>
            sandbox.execute(
              {
                cell: { id: cell.sourceCellId!, source: input.source },
                parameters: input.parameters,
              },
              {
                signal,
                limits,
              },
            ),
          { signal },
        ),
        aborted,
      ]);
      signal.throwIfAborted();
      ({ outputs, definitions, references } = executed);
    } catch (caught) {
      const cause: unknown = signal.aborted ? signal.reason : caught;
      errorCode =
        cause instanceof ResearchError && cause.embeddedCode !== undefined
          ? cause.embeddedCode
          : 'execution_failed';
      error = (cause instanceof Error ? cause.message : String(cause)).slice(0, 8_000);
      if (caught instanceof ResearchPythonExecutionError) {
        ({ outputs, definitions, references } = caught);
      }
    }
    let materialized: MaterializedResearchOutputs;
    try {
      materialized = materializeResearchOutputArtifacts(outputs, documentId);
    } catch (caught) {
      errorCode = 'execution_failed';
      error = (caught instanceof Error ? caught.message : String(caught)).slice(0, 8_000);
      materialized = { outputs: [], artifacts: [] };
    }
    return {
      runId,
      cellExecutionId: cell.id,
      status: errorCode ? 'error' : 'success',
      errorCode,
      error,
      definitions,
      references,
      materialized,
    };
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    if (poll) {
      clearInterval(poll);
    }
    if (abortListener) {
      signal.removeEventListener('abort', abortListener);
    }
    controller.abort(new ResearchError('embedded_cancelled'));
    if (documentId) {
      researchSandboxPool.close(documentId);
    }
    if (activeControllers.get(runId) === controller) {
      activeControllers.delete(runId);
    }
  }
}
