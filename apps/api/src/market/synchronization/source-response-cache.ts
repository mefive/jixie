import { mkdtemp, writeFile, readFile, unlink, rmdir, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TushareRow } from '../providers/tushare/tushare-client.js';
import type { SyncSource } from './source.js';
import type { SourceMeasurements } from '../providers/source-fetch.js';
import { MarketSourceStorageError } from '../errors.js';

interface CachedResponse {
  key: string;
  rows?: TushareRow[];
  file?: string;
  bytes: number;
  error?: unknown;
}

/** 原始响应字节高水位；超额页面落盘。 / Spill pages above the shared raw-response high-water mark. */
export class SourceResponseBudget {
  bytes = 0;
  constructor(readonly maximum: number) {}
  reserve(bytes: number) {
    if (this.bytes + bytes > this.maximum) {
      return false;
    }
    this.bytes += bytes;

    return true;
  }
}

/**
 * 下载一次，按原请求顺序回放给正式准备入口；临时文件不证明成功。
 *
 * Download once and replay the exact sequence to preparation; temporary files prove no coverage.
 */
export class SourceResponseCache {
  private entries: CachedResponse[] = [];
  private directory?: string;
  storageFailure?: unknown;

  constructor(
    private readonly budget: SourceResponseBudget,
    private readonly identity = 'unbound',
  ) {}

  /** 已取得 Run 执行权后清理该 Run 的孤立临时文件。 / Reclaim only this owned run's abandoned temporary responses. */
  static async reclaim(identity: string) {
    const prefix = `jixie-source-${identity.replace(/[^a-zA-Z0-9]/g, '')}-`;
    for (const entry of await readdir(tmpdir(), { withFileTypes: true })) {
      if (!entry.name.startsWith(prefix) || !entry.isDirectory()) {
        continue;
      }
      const directory = join(tmpdir(), entry.name);
      const info = await lstat(directory);
      const files = await readdir(directory, { withFileTypes: true });
      if (
        (info.mode & 0o077) !== 0 ||
        files.some((file) => !file.isFile() || !/^\d+\.json$/.test(file.name))
      ) {
        continue;
      }
      for (const file of files) {
        await unlink(join(directory, file.name));
      }
      await rmdir(directory);
    }
  }

  record(source: SyncSource, metrics: SourceMeasurements, clock: () => Date): SyncSource {
    return {
      call: async (api, params = {}, fields) => {
        const key = this.key(api, params, fields);
        const previousCount = metrics.httpRequests;
        const began = clock().toISOString();
        let rows: TushareRow[];
        try {
          rows = await source.call(api, params, fields);
        } catch (error) {
          if (error instanceof MarketSourceStorageError) {
            this.storageFailure = error;
          }
          this.entries.push({ key, bytes: 0, error });
          throw error;
        } finally {
          if (!source.tracksHttp && metrics.httpRequests === previousCount) {
            metrics.httpRequests++;
            metrics.sourceStartedAt ??= began;
            metrics.sourceFinishedAt = clock().toISOString();
          }
        }
        const text = JSON.stringify(rows);
        const bytes = Buffer.byteLength(text);
        if (this.budget.reserve(bytes)) {
          this.entries.push({ key, bytes, rows });
        } else {
          try {
            this.directory ??= await mkdtemp(
              join(tmpdir(), `jixie-source-${this.identity.replace(/[^a-zA-Z0-9]/g, '')}-`),
            );
            const file = join(this.directory, `${this.entries.length}.json`);
            await writeFile(file, text, { mode: 0o600 });
            this.entries.push({ key, bytes: 0, file });
          } catch (error) {
            this.storageFailure = error;
            throw error;
          }
        }

        return rows;
      },
    };
  }

  replay(): SyncSource {
    let cursor = 0;

    return {
      call: async (api, params = {}, fields) => {
        const entry = this.entries[cursor++];
        if (!entry || entry.key !== this.key(api, params, fields)) {
          throw new MarketSourceStorageError(
            'Downloaded source request does not match preparation',
          );
        }
        if (entry.error !== undefined) {
          throw entry.error;
        }

        if (entry.rows) {
          return entry.rows;
        }
        try {
          return JSON.parse(await readFile(entry.file!, 'utf8')) as TushareRow[];
        } catch (error) {
          throw new MarketSourceStorageError('Unable to replay downloaded source response', {
            cause: error,
          });
        }
      },
    };
  }

  private key(api: string, params: Record<string, unknown>, fields?: string) {
    return JSON.stringify([
      api,
      Object.entries(params).sort(([left], [right]) => left.localeCompare(right)),
      fields ?? '',
    ]);
  }

  async dispose() {
    const entries = this.entries;
    this.entries = [];
    for (const entry of entries) {
      this.budget.bytes -= entry.bytes;
    }
    if (this.directory) {
      for (const name of await readdir(this.directory)) {
        await unlink(join(this.directory, name));
      }
      await rmdir(this.directory);
      this.directory = undefined;
    }
  }
}
