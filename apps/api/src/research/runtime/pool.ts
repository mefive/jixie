import { ResearchPythonExecutionError, ResearchPythonInterruptionError } from '../errors.js';
import { ResearchRuntime } from './research-runtime.js';

const MAX_LIVE_RESEARCH_SESSIONS = 4;

interface ResearchRuntimeEntry {
  runtime: ResearchRuntime;
  queue: Promise<void>;
  touchedAt: number;
  pendingOperations: number;
}

export class ResearchRuntimePool {
  private readonly entries = new Map<string, ResearchRuntimeEntry>();
  private entryAcquisitionQueue: Promise<void> = Promise.resolve();

  async withRuntime<Result>(
    documentId: string,
    operation: (runtime: ResearchRuntime) => Promise<Result>,
    options: { signal?: AbortSignal } = {},
  ): Promise<Result> {
    options.signal?.throwIfAborted();
    const entry = await this.acquireEntry(documentId, options.signal);
    return this.useEntry(documentId, entry, operation, options.signal);
  }

  interrupt(documentId: string): string | null {
    const entry = this.entries.get(documentId);
    if (!entry?.runtime.activeCellId) {
      return null;
    }
    const cellId = entry.runtime.activeCellId;
    this.entries.delete(documentId);
    entry.runtime.interrupt();
    return cellId;
  }

  activeCellId(documentId: string): string | null {
    return this.entries.get(documentId)?.runtime.activeCellId ?? null;
  }

  async reset(documentId: string): Promise<void> {
    const entry = this.entries.get(documentId);
    if (!entry) {
      return;
    }
    entry.pendingOperations += 1;
    await this.useEntry(documentId, entry, (runtime) => runtime.reset());
  }

  close(documentId: string): void {
    const entry = this.entries.get(documentId);
    if (!entry) {
      return;
    }
    this.entries.delete(documentId);
    entry.runtime.close();
  }

  private async useEntry<T>(
    documentId: string,
    entry: ResearchRuntimeEntry,
    operation: (runtime: ResearchRuntime) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const abort = () => entry.runtime.abort(new Error('Research execution aborted'));
    signal?.addEventListener('abort', abort, { once: true });
    const result = entry.queue.then(() => {
      signal?.throwIfAborted();
      return operation(entry.runtime);
    });
    entry.queue = result.then(
      () => undefined,
      () => undefined,
    );
    try {
      return await result;
    } catch (error) {
      if (
        entry.runtime.isClosed ||
        (!(error instanceof ResearchPythonExecutionError) &&
          !(error instanceof ResearchPythonInterruptionError))
      ) {
        if (this.entries.get(documentId) === entry) {
          this.close(documentId);
        }
      }
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
      entry.pendingOperations -= 1;
      entry.touchedAt = Date.now();
    }
  }

  private async acquireEntry(
    documentId: string,
    signal?: AbortSignal,
  ): Promise<ResearchRuntimeEntry> {
    const acquisition = this.entryAcquisitionQueue.then(async () => {
      signal?.throwIfAborted();
      const entry = await this.getOrCreate(documentId, signal);
      entry.pendingOperations += 1;
      return entry;
    });
    this.entryAcquisitionQueue = acquisition.then(
      () => undefined,
      () => undefined,
    );
    return acquisition;
  }

  private async getOrCreate(
    documentId: string,
    signal?: AbortSignal,
  ): Promise<ResearchRuntimeEntry> {
    const existing = this.entries.get(documentId);
    if (existing) {
      return existing;
    }
    if (this.entries.size >= MAX_LIVE_RESEARCH_SESSIONS) {
      const oldest = [...this.entries.entries()]
        .filter(([, entry]) => entry.pendingOperations === 0)
        .sort((left, right) => left[1].touchedAt - right[1].touchedAt)[0];
      if (oldest) {
        this.close(oldest[0]);
      } else {
        throw new Error(
          `Python sandbox is busy (${this.entries.size}/${MAX_LIVE_RESEARCH_SESSIONS} Research sessions)`,
        );
      }
    }

    const runtime = await ResearchRuntime.start({ documentId, signal });
    const entry: ResearchRuntimeEntry = {
      runtime,
      queue: Promise.resolve(),
      touchedAt: Date.now(),
      pendingOperations: 0,
    };
    this.entries.set(documentId, entry);
    return entry;
  }
}

export const researchRuntimePool = new ResearchRuntimePool();
