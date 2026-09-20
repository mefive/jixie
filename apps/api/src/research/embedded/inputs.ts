import { prisma } from '#infra/database/prisma.js';
import { RESEARCH_EMBEDDED_LIMITS, type ResearchEmbeddedLimitsV1 } from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import { ResearchError } from '../errors.js';
import type { ResearchRequestObserver, ResearchResponse } from '../runtime/host/dispatch.js';
import type { ResearchRequestFrame } from '../runtime/host/protocol.js';

/** Persist before delivery, so a Python try/except cannot turn missing evidence into success. */
export function embeddedInputRecorder(
  runId: string,
  signal: AbortSignal,
  limits: ResearchEmbeddedLimitsV1 = RESEARCH_EMBEDDED_LIMITS,
): ResearchRequestObserver {
  let sequence = 0;
  let inputBytes = 0;
  let pending: { id: string; requestId: number | string } | undefined;
  return {
    async beforeRequest(frame) {
      signal.throwIfAborted();
      sequence += 1;
      if (sequence > limits.sdkRequests) {
        throw new ResearchError('embedded_request_limit');
      }
      const argumentBytes = Buffer.byteLength(JSON.stringify(frame.arguments), 'utf8');
      if (inputBytes + argumentBytes > limits.inputBytes) {
        throw new ResearchError('embedded_input_limit');
      }
      const id = ulid();
      await prisma.$transaction(async (transaction) => {
        await assertActiveRun(transaction, runId, signal);
        await transaction.researchExecutionInput.create({
          data: {
            id,
            executionId: runId,
            sequence,
            method: frame.method,
            arguments: frame.arguments as Prisma.InputJsonValue,
            status: 'loading',
          },
        });
      });
      inputBytes += argumentBytes;
      pending = { id, requestId: frame.id };
    },
    async captureResponse(frame: ResearchRequestFrame, response: ResearchResponse) {
      signal.throwIfAborted();
      if (!pending || pending.requestId !== frame.id) {
        throw new Error('SDK response does not match its recorded request');
      }
      const responseJson = JSON.stringify(response);
      const byteSize = Buffer.byteLength(responseJson, 'utf8');
      if (inputBytes + byteSize > limits.inputBytes) {
        throw new ResearchError('embedded_input_limit');
      }
      const sha256 = createHash('sha256').update(responseJson).digest('hex');
      const rowCount =
        'result' in response && Array.isArray(response.result.rows)
          ? response.result.rows.length
          : null;
      const inputId = pending.id;
      await prisma.$transaction(async (transaction) => {
        await assertActiveRun(transaction, runId, signal);
        await transaction.researchExecutionInput.update({
          where: { id: inputId, status: 'loading' },
          data: {
            responseJson,
            metadata: responseMetadata(frame, response) as Prisma.InputJsonValue,
            byteSize,
            sha256,
            rowCount,
            status: 'error' in response ? 'error' : 'received',
            error: 'error' in response ? response.error.slice(0, 8_000) : null,
            capturedAt: new Date(),
          },
        });
      });
      inputBytes += byteSize;
      pending = undefined;
    },
  };
}

export async function assertActiveRun(
  transaction: Prisma.TransactionClient,
  runId: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const active = await transaction.researchExecution.findFirst({
    where: { id: runId, status: 'running', job: { status: 'running' } },
    select: { id: true },
  });
  if (!active) {
    throw new ResearchError('embedded_cancelled');
  }
  signal.throwIfAborted();
}

/** Only copy metadata already defined by the SDK; never infer adjustment/currency semantics. */
function responseMetadata(
  frame: ResearchRequestFrame,
  response: ResearchResponse,
): Record<string, unknown> {
  if ('error' in response) {
    return {};
  }
  const { result } = response;
  const metadata: Record<string, unknown> = {};
  for (const key of [
    'metadata',
    'diagnostics',
    'lineage',
    'report_id',
    'created_at',
    'computed_at',
  ]) {
    if (result[key] !== undefined) {
      metadata[key] = result[key];
    }
  }
  if (
    ['research_series', 'research_macro', 'research_fx', 'research_yield_curve'].includes(
      frame.method,
    ) &&
    Array.isArray(result.rows)
  ) {
    const dates = result.rows
      .flatMap((row: unknown) =>
        row && typeof row === 'object' && 'date' in row && typeof row.date === 'string'
          ? [row.date]
          : [],
      )
      .sort();
    if (dates.length) {
      metadata.observedRange = { start: dates[0], end: dates[dates.length - 1] };
    }
  }
  if (Buffer.byteLength(JSON.stringify(metadata), 'utf8') > 64 * 1024) {
    return {
      metadataPreviewOmitted: true,
      ...(metadata.observedRange ? { observedRange: metadata.observedRange } : {}),
    };
  }
  return metadata;
}
