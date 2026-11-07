import { downloadMarketPartition } from '#market/synchronization/download.js';
import {
  SourceResponseCache,
  SourceResponseBudget,
} from '#market/synchronization/source-response-cache.js';
import {
  withImportDiagnostics,
  type ImportDiagnostics,
} from '#market/synchronization/diagnostics.js';
import { withSourceMeasurements, withSourceRequestBudget } from '#market/providers/source-fetch.js';
import type { SourceExecution } from '#market/synchronization/execution.js';
import type { IngestionInput, IngestionUnit } from './schema.js';
import { unitKey } from './runs.js';
import { MarketSyncBudgetError } from '#market/errors.js';

export interface PrefetchedBatch {
  id: string;
  startedAt: Date;
  readyAt: number;
  cache: SourceResponseCache;
  execution: SourceExecution;
  diagnostics: ImportDiagnostics;
  failure?: unknown;
}
interface PendingBatch {
  unit: IngestionUnit;
  head: boolean;
  running: boolean;
  settled: boolean;
  result?: PrefetchedBatch;
  promise: Promise<PrefetchedBatch>;
  resolve: (result: PrefetchedBatch) => void;
  reject: (error: unknown) => void;
}
export interface BatchPrefetcherOptions {
  runId: string;
  source: IngestionInput['source'];
  signal: AbortSignal;
  concurrency: number;
  bufferBytes: number;
  clock: () => Date;
  start: (unit: IngestionUnit, startedAt: Date) => Promise<string>;
  discard: (unit: IngestionUnit, result: PrefetchedBatch) => Promise<void>;
  ready: (unit: IngestionUnit, result: PrefetchedBatch) => Promise<void>;
}

/**
 * 最多八批预取，始终为当前批次保留下载通道；写入只由调用者顺序执行。
 *
 * Bound prefetch and reserve head admission; callers alone prepare and write in order.
 */
export class BatchPrefetcher {
  private pending = new Map<string, PendingBatch>();
  private active = 0;
  private controller = new AbortController();
  private budget: SourceResponseBudget;
  private closed = false;
  private limit: number;

  constructor(private readonly options: BatchPrefetcherOptions) {
    if (
      !Number.isInteger(options.concurrency) ||
      options.concurrency < 1 ||
      options.concurrency > 4 ||
      !Number.isFinite(options.bufferBytes) ||
      options.bufferBytes <= 0
    ) {
      throw new Error('Invalid ingestion prefetch settings');
    }
    this.limit = Math.max(2, options.concurrency * 2);
    this.budget = new SourceResponseBudget(options.bufferBytes);
    options.signal.addEventListener('abort', this.cancelQueued, { once: true });
  }

  prefetch(units: readonly IngestionUnit[]) {
    for (const unit of units) {
      if (this.closed || this.options.signal.aborted || this.pending.size >= this.limit - 1) {
        break;
      }
      if (!this.pending.has(unitKey(unit))) {
        this.enqueue(unit);
      }
    }
    this.pump();
  }

  private enqueue(unit: IngestionUnit) {
    let resolve!: PendingBatch['resolve'];
    let reject!: PendingBatch['reject'];
    const promise = new Promise<PrefetchedBatch>((accept, fail) => {
      resolve = accept;
      reject = fail;
    });
    // 后台故障由顺序消费端或 close 观察，不能产生未处理拒绝。
    // Observe background rejection later in ordered consumption or close.
    void promise.catch(() => undefined);
    const entry: PendingBatch = {
      unit,
      head: false,
      running: false,
      settled: false,
      promise,
      resolve,
      reject,
    };
    this.pending.set(unitKey(unit), entry);

    return entry;
  }

  async take(unit: IngestionUnit) {
    if (this.closed || this.options.signal.aborted) {
      throw new MarketSyncBudgetError();
    }
    const entry = this.pending.get(unitKey(unit)) ?? this.enqueue(unit);
    entry.head = true;
    this.pump();
    const result = await entry.promise;
    if (result.failure) {
      throw result.failure;
    }

    return result;
  }

  private pump() {
    if (this.closed || this.options.signal.aborted) {
      return;
    }
    const entries = [...this.pending.values()].sort(
      (left, right) => Number(right.head) - Number(left.head),
    );
    for (const entry of entries) {
      if (entry.running || entry.settled) {
        continue;
      }
      const background = [...this.pending.values()].filter(
        (pending) => pending.running && !pending.settled && !pending.head,
      ).length;
      if (
        this.active >= this.options.concurrency ||
        (!entry.head && background >= this.options.concurrency - 1) ||
        (!entry.head && this.budget.bytes >= this.budget.maximum)
      ) {
        continue;
      }
      entry.running = true;
      this.active++;
      void this.download(entry)
        .then(entry.resolve, entry.reject)
        .finally(() => {
          entry.settled = true;
          this.active--;
          this.pump();
        });
    }
  }

  private async download(entry: PendingBatch): Promise<PrefetchedBatch> {
    const startedAt = this.options.clock();
    const id = await this.options.start(entry.unit, startedAt);
    const cache = new SourceResponseCache(this.budget, this.options.runId);
    const execution: SourceExecution = {
      sourceStartedAt: null,
      sourceFinishedAt: null,
      httpRequests: 0,
      retries: 0,
      rateLimitMs: 0,
      downloadMs: 0,
      queueMs: 0,
      prepareMs: 0,
      writeMs: null,
    };
    const diagnostics: ImportDiagnostics = { requests: [], issues: [] };
    const start = performance.now();
    const signal = AbortSignal.any([this.options.signal, this.controller.signal]);
    try {
      await withSourceRequestBudget({ remaining: Infinity, deadline: Infinity, signal }, () =>
        withSourceMeasurements(execution, () =>
          withImportDiagnostics(diagnostics, () =>
            downloadMarketPartition(
              cache.record(this.options.source, execution, this.options.clock),
              entry.unit,
            ),
          ),
        ),
      );
    } catch {
      // 来源或范围错误由回放正式准备入口重现；只有缓冲存储失败直接终止运行。
      // Replay source/range errors through preparation; buffer storage failures stop the run.
    }
    execution.downloadMs = Math.max(0, performance.now() - start);
    const result: PrefetchedBatch = {
      id,
      startedAt,
      cache,
      execution,
      diagnostics,
      readyAt: performance.now(),
      failure: cache.storageFailure,
    };
    entry.result = result;
    await this.options.ready(entry.unit, result);

    return result;
  }

  async release(unit: IngestionUnit) {
    const entry = this.pending.get(unitKey(unit));
    if (!entry) {
      return;
    }
    const result = await entry.promise;
    await result.cache.dispose();
    this.pending.delete(unitKey(unit));
    this.pump();
  }

  async close() {
    this.closed = true;
    this.controller.abort();
    this.options.signal.removeEventListener('abort', this.cancelQueued);
    this.cancelQueued();
    const entries = [...this.pending.values()];
    let failure: unknown;
    for (const entry of entries) {
      if (!entry.running) {
        this.pending.delete(unitKey(entry.unit));
        continue;
      }
      let result: PrefetchedBatch | undefined;
      try {
        result = await entry.promise;
      } catch (error) {
        failure ??= error;
        result = entry.result;
      }
      if (result) {
        try {
          await this.options.discard(entry.unit, result);
        } catch (error) {
          failure ??= error;
        }
        try {
          await result.cache.dispose();
        } catch (error) {
          failure ??= error;
        }
      }
    }
    this.pending.clear();
    if (failure) {
      throw failure;
    }
  }

  private cancelQueued = () => {
    for (const entry of this.pending.values()) {
      if (!entry.running && !entry.settled) {
        entry.settled = true;
        entry.reject(new MarketSyncBudgetError());
      }
    }
  };
}
