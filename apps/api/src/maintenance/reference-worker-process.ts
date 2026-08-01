import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { ReferenceSyncSummary } from '../store/sync.js';
import type { ReferenceWorkerMessage, ReferenceWorkerStage } from './reference-worker.js';

export async function runReferenceWorkerProcess(
  stage: ReferenceWorkerStage,
  checkpointRunId: string | null,
  codes: string[],
): Promise<ReferenceSyncSummary> {
  if (codes.length === 0) {
    return emptyReferenceSyncSummary();
  }

  const workerPath = referenceWorkerPath();
  return new Promise((resolve, reject) => {
    const child = fork(workerPath, [stage, checkpointRunId ?? '-', ...codes], {
      env: process.env,
      execArgv: workerPath.endsWith('.ts') ? process.execArgv : [],
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    });
    let summary: ReferenceSyncSummary | null = null;
    let settled = false;

    child.on('message', (message: unknown) => {
      if (isReferenceWorkerMessage(message)) {
        summary = message.summary;
      }
    });
    child.once('error', (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.once('exit', (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      if (code === 0 && summary) {
        resolve(summary);
        return;
      }
      reject(
        new Error(
          `Reference worker ${stage} exited ${signal ? `from signal ${signal}` : `with code ${code ?? 'unknown'}`}`,
        ),
      );
    });
  });
}

export function chunkReferenceCodes(codes: string[], chunkSize: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < codes.length; index += chunkSize) {
    chunks.push(codes.slice(index, index + chunkSize));
  }
  return chunks;
}

export function emptyReferenceSyncSummary(): ReferenceSyncSummary {
  return {
    requested: 0,
    skipped: 0,
    processed: 0,
    changed: 0,
    created: 0,
    updated: 0,
    deleted: 0,
  };
}

export function addReferenceSyncSummary(
  total: ReferenceSyncSummary,
  current: ReferenceSyncSummary,
): ReferenceSyncSummary {
  return {
    requested: total.requested + current.requested,
    skipped: total.skipped + current.skipped,
    processed: total.processed + current.processed,
    changed: total.changed + current.changed,
    created: total.created + current.created,
    updated: total.updated + current.updated,
    deleted: total.deleted + current.deleted,
  };
}

function referenceWorkerPath(): string {
  const extension = fileURLToPath(import.meta.url).endsWith('.ts') ? 'ts' : 'js';
  return fileURLToPath(new URL(`./reference-worker.${extension}`, import.meta.url));
}

function isReferenceWorkerMessage(message: unknown): message is ReferenceWorkerMessage {
  if (!message || typeof message !== 'object') {
    return false;
  }
  const candidate = message as Partial<ReferenceWorkerMessage>;
  return candidate.type === 'reference-worker-summary' && candidate.summary != null;
}
