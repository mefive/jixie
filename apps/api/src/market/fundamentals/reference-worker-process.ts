import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { ReferenceSyncSummary } from './reference-sync.js';
import {
  isReferenceWorkerMessage,
  type ReferenceWorkerStage,
} from './reference-worker-protocol.js';

export interface ReferenceWorkerProcessOptions {
  onItemComplete?: (item: string) => Promise<void>;
}

export async function runReferenceWorkerProcess(
  stage: ReferenceWorkerStage,
  codes: string[],
  options: ReferenceWorkerProcessOptions = {},
): Promise<ReferenceSyncSummary> {
  if (codes.length === 0) {
    return emptyReferenceSyncSummary();
  }

  const workerPath = referenceWorkerPath();
  return new Promise((resolve, reject) => {
    const child = fork(workerPath, [stage, ...codes], {
      env: process.env,
      execArgv: workerPath.endsWith('.ts') ? process.execArgv : [],
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    });
    let summary: ReferenceSyncSummary | null = null;
    let failure: Error | null = null;
    let pending = Promise.resolve();
    const acknowledged = new Set<string>();

    child.on('message', (message: unknown) => {
      pending = pending
        .then(async () => {
          if (failure) {
            return;
          }
          if (!isReferenceWorkerMessage(message)) {
            throw new Error('Invalid reference worker message');
          }
          if (message.type === 'reference-worker-summary') {
            summary = message.summary;
            return;
          }
          if (!codes.includes(message.item) || acknowledged.has(message.item)) {
            throw new Error('Unexpected reference worker completion');
          }
          await options.onItemComplete?.(message.item);
          acknowledged.add(message.item);
          await new Promise<void>((resolve, reject) => {
            child.send({ type: 'reference-worker-acknowledged', item: message.item }, (error) => {
              if (error) {
                reject(error);
              } else {
                resolve();
              }
            });
          });
        })
        .catch((error: unknown) => {
          failure = error instanceof Error ? error : new Error(String(error));
          child.kill();
        });
    });
    child.once('error', (error) => {
      failure ??= error;
    });
    child.once('close', (code, signal) => {
      void pending.then(() => {
        if (failure) {
          reject(failure);
        } else if (code === 0 && summary && acknowledged.size === new Set(codes).size) {
          resolve(summary);
        } else {
          reject(
            new Error(
              `Reference worker ${stage} exited ${signal ? `from signal ${signal}` : `with code ${code ?? 'unknown'}`} without complete acknowledged results`,
            ),
          );
        }
      });
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
