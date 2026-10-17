import { ResearchPythonExecutionError, ResearchPythonInterruptionError } from '../errors.js';
import { ResearchSandbox } from './research-sandbox.js';

const MAX_LIVE_RESEARCH_SESSIONS = 4;

/**
 * 维护文档沙盒创建、引用和关闭状态，供池化生命周期。
 * Track document sandbox creation, references and closure in the pool.
 */
interface ResearchSandboxEntry {
  sandbox: ResearchSandbox;
  queue: Promise<void>;
  touchedAt: number;
  pendingOperations: number;
}

export class ResearchSandboxPool {
  private readonly entries = new Map<string, ResearchSandboxEntry>();
  private entryAcquisitionQueue: Promise<void> = Promise.resolve();

  async withSandbox<Result>(
    documentId: string,
    operation: (sandbox: ResearchSandbox) => Promise<Result>,
    options: { signal?: AbortSignal } = {},
  ): Promise<Result> {
    options.signal?.throwIfAborted();
    const entry = await this.acquireEntry(documentId, options.signal);
    return this.useEntry(documentId, entry, operation, options.signal);
  }

  interrupt(documentId: string): string | null {
    const entry = this.entries.get(documentId);
    if (!entry?.sandbox.activeCellId) {
      return null;
    }
    const cellId = entry.sandbox.activeCellId;
    this.entries.delete(documentId);
    entry.sandbox.interrupt();
    return cellId;
  }

  activeCellId(documentId: string): string | null {
    return this.entries.get(documentId)?.sandbox.activeCellId ?? null;
  }

  async reset(documentId: string): Promise<void> {
    const entry = this.entries.get(documentId);
    if (!entry) {
      return;
    }
    entry.pendingOperations += 1;
    await this.useEntry(documentId, entry, (sandbox) => sandbox.reset());
  }

  close(documentId: string): void {
    const entry = this.entries.get(documentId);
    if (!entry) {
      return;
    }
    this.entries.delete(documentId);
    entry.sandbox.close();
  }

  /**
   * 在会话池条目中串行使用沙盒，处理在途引用与释放。
   * Use a pooled sandbox entry with serialized access and lifetime tracking.
   */
  private async useEntry<T>(
    documentId: string,
    entry: ResearchSandboxEntry,
    operation: (sandbox: ResearchSandbox) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const abort = () => entry.sandbox.abort(new Error('Research execution aborted'));
    signal?.addEventListener('abort', abort, { once: true });
    const result = entry.queue.then(() => {
      signal?.throwIfAborted();
      return operation(entry.sandbox);
    });
    entry.queue = result.then(
      () => undefined,
      () => undefined,
    );
    try {
      return await result;
    } catch (error) {
      if (
        entry.sandbox.isClosed ||
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
  ): Promise<ResearchSandboxEntry> {
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

  /**
   * 按文档复用或创建 Research 会话，协调并发创建与关闭清理。
   * Reuse or create a document sandbox while coordinating concurrent creation and cleanup.
   */
  private async getOrCreate(
    documentId: string,
    signal?: AbortSignal,
  ): Promise<ResearchSandboxEntry> {
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

    const sandbox = await ResearchSandbox.start({ documentId, signal });
    const entry: ResearchSandboxEntry = {
      sandbox,
      queue: Promise.resolve(),
      touchedAt: Date.now(),
      pendingOperations: 0,
    };
    this.entries.set(documentId, entry);
    return entry;
  }
}

export const researchSandboxPool = new ResearchSandboxPool();
