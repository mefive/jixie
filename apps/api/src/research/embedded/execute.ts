import { researchRuntimePool } from '../runtime/pool.js';
import { prisma } from '#infra/database/prisma.js';
import {
  type ResearchCellOutputBlockV1,
  type ResearchEmbeddedErrorCodeV1,
  type ResearchEmbeddedLimitsV1,
  type ResearchEmbeddedParametersV1,
} from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import { ResearchError, ResearchPythonExecutionError } from '../errors.js';
import {
  materializeResearchOutputArtifacts,
  type MaterializedResearchOutputs,
} from '../evidence/artifacts.js';
import { researchPayloadHash } from '../evidence/fingerprints.js';

import { assertActiveRun, embeddedInputRecorder } from './inputs.js';

const activeControllers = new Map<string, AbortController>();
export function abortEmbeddedRuntime(runId: string) {
  activeControllers.get(runId)?.abort(new ResearchError('embedded_cancelled'));
}

export interface EmbeddedExecutionResult {
  runId: string;
  cellExecutionId: string;
  status: 'success' | 'error';
  errorCode: ResearchEmbeddedErrorCodeV1 | null;
  error: string | null;
  environmentFingerprint: string | null;
  definitions: string[];
  references: string[];
  materialized: MaterializedResearchOutputs;
}

export async function executeEmbeddedRun(
  runId: string,
  userId: string,
): Promise<EmbeddedExecutionResult> {
  const controller = new AbortController();
  activeControllers.set(runId, controller);
  const { signal } = controller;
  let documentId: string | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  let abortListener: (() => void) | undefined;
  try {
    const run = await prisma.$transaction(async (transaction) => {
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
    documentId = run.documentId;
    const cell = run.cellExecutions[0];
    const {
      embedded: { limits },
    } = run.sourceSnapshot as unknown as { embedded: { limits: ResearchEmbeddedLimitsV1 } };
    researchRuntimePool.close(documentId);
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
      void prisma.researchExecution
        .findUnique({ where: { id: runId }, select: { status: true } })
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
    let environmentFingerprint: string | null = null;
    let errorCode: ResearchEmbeddedErrorCodeV1 | null = null;
    let error: string | null = null;
    try {
      const executed = await Promise.race([
        researchRuntimePool.withRuntime(
          documentId,
          (runtime) =>
            runtime.execute(
              {
                cell: { id: cell.sourceCellId!, source: cell.source },
                parameters: run.parametersSnapshot as ResearchEmbeddedParametersV1,
              },
              {
                signal,
                observer: embeddedInputRecorder(runId, signal, limits),
                async captureEnvironment(environment) {
                  await prisma.$transaction(async (transaction) => {
                    await assertActiveRun(transaction, runId, signal);
                    await transaction.researchExecution.update({
                      where: { id: runId, status: 'running' },
                      data: {
                        environmentSnapshot: environment as Prisma.InputJsonValue,
                        environmentFingerprint: researchPayloadHash(environment),
                      },
                    });
                  });
                },
              },
            ),
          { signal },
        ),
        aborted,
      ]);
      signal.throwIfAborted();
      ({ outputs, definitions, references, environmentFingerprint } = executed);
    } catch (caught) {
      const cause: unknown = signal.aborted ? signal.reason : caught;
      errorCode =
        cause instanceof ResearchError && cause.embeddedCode !== undefined
          ? cause.embeddedCode
          : 'execution_failed';
      error = (cause instanceof Error ? cause.message : String(cause)).slice(0, 8_000);
      if (caught instanceof ResearchPythonExecutionError) {
        ({ outputs, definitions, references, environmentFingerprint } = caught);
      }
    }
    let materialized: MaterializedResearchOutputs;
    try {
      materialized = materializeResearchOutputArtifacts(outputs, documentId, cell.id);
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
      environmentFingerprint,
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
      researchRuntimePool.close(documentId);
    }
    if (activeControllers.get(runId) === controller) {
      activeControllers.delete(runId);
    }
  }
}
