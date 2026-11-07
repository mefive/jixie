import { createHash } from 'node:crypto';
import { open, mkdir, lstat, rename, type FileHandle } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { MarketSyncBudgetError, MarketSourceStorageError } from '../../errors.js';

export interface TushareRateLimit {
  perMinute: number;
  perDay?: number;
}
export interface TushareLimiterOptions {
  token: string;
  concurrency: number;
  minIntervalMs: number;
  perMinute: number;
  apiLimits?: Readonly<Record<string, TushareRateLimit>>;
  quotaDirectory?: string;
}
interface Reservation {
  api: string;
  at: number;
}

/**
 * 一个账号共享发送窗口；额度先落盘，再发送，进程退出释放 OS 锁。
 *
 * Share account admission, durably reserve before sending, and release ownership on process exit.
 */
export class TushareRequestLimiter {
  private active = 0;
  private nextAt = 0;
  private cooldownUntil = 0;
  private closed = false;
  private tail: Promise<unknown> = Promise.resolve();
  private initialized?: Promise<void>;
  private ledger?: FileHandle;
  private owner?: FileHandle;
  private ledgerPath?: string;
  private compactedAt = 0;
  private reservations: Reservation[] = [];
  private wakes = new Set<() => void>();

  constructor(private readonly options: TushareLimiterOptions) {
    for (const value of [options.concurrency, options.minIntervalMs, options.perMinute]) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error('Invalid Tushare admission limit');
      }
    }
    if (!Number.isInteger(options.concurrency) || !Number.isInteger(options.perMinute)) {
      throw new Error('Tushare concurrency and minute quota must be integers');
    }
    for (const limit of Object.values(options.apiLimits ?? {})) {
      if (
        !Number.isInteger(limit.perMinute) ||
        limit.perMinute < 1 ||
        (limit.perDay !== undefined && (!Number.isInteger(limit.perDay) || limit.perDay < 1))
      ) {
        throw new Error('Invalid Tushare API quota');
      }
    }
  }

  private serialize<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);

    return result;
  }

  private async initialize() {
    if (!this.options.quotaDirectory) {
      return;
    }
    const directory = this.options.quotaDirectory;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await lstat(directory);
    if (!info.isDirectory() || (info.mode & 0o077) !== 0) {
      throw new Error('Tushare quota directory must be private');
    }
    const identity = createHash('sha256').update(this.options.token).digest('hex');
    this.owner = await open(
      join(directory, `${identity}.lock`),
      constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const binding = (await import('fs-ext')).default;
      binding.flockSync(this.owner.fd, 'exnb');
      this.ledgerPath = join(directory, `${identity}.jsonl`);
      this.ledger = await open(
        this.ledgerPath,
        constants.O_CREAT | constants.O_RDWR | constants.O_APPEND | constants.O_NOFOLLOW,
        0o600,
      );
      const text = await this.ledger.readFile('utf8');
      const end = text.lastIndexOf('\n') + 1;
      // 未完成的尾记录尚未允许 HTTP 发出，可安全丢弃；内部损坏则拒绝发送。
      // An incomplete tail never admitted HTTP; discard it, but reject interior corruption.
      if (end < text.length) {
        await this.ledger.truncate(Buffer.byteLength(text.slice(0, end)));
      }
      for (const line of text.slice(0, end).split('\n').filter(Boolean)) {
        const value = JSON.parse(line) as Record<string, unknown>;
        if (typeof value.at !== 'number' || !Number.isFinite(value.at)) {
          throw new Error('Invalid Tushare quota record');
        }
        if (typeof value.api === 'string') {
          this.reservations.push({ api: value.api, at: value.at });
        } else if (
          typeof value.cooldownUntil === 'number' &&
          Number.isFinite(value.cooldownUntil)
        ) {
          this.cooldownUntil = Math.max(this.cooldownUntil, value.cooldownUntil);
        } else {
          throw new Error('Invalid Tushare quota record');
        }
      }
      this.reservations = this.reservations.filter((entry) => entry.at > Date.now() - 86_400_000);
      await this.compact();
    } catch (error) {
      await this.ledger?.close();
      this.ledger = undefined;
      await this.owner.close();
      this.owner = undefined;
      throw error;
    }
  }

  /** 截断日记只在账号锁内进行，原子替换保留最近 24 小时。 / Compact atomically under ownership, retaining the last 24 hours. */
  private async compact() {
    if (!this.ledgerPath) {
      return;
    }
    const staging = this.ledgerPath + '.next';
    const file = await open(
      staging,
      constants.O_CREAT | constants.O_TRUNC | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const lines = this.reservations.map((entry) => JSON.stringify(entry));
      if (this.cooldownUntil > Date.now()) {
        lines.push(JSON.stringify({ at: Date.now(), cooldownUntil: this.cooldownUntil }));
      }
      await file.writeFile(lines.length ? lines.join('\n') + '\n' : '');
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(staging, this.ledgerPath);
    const directory = await open(this.options.quotaDirectory!, 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    await this.ledger?.close();
    this.ledger = await open(
      this.ledgerPath,
      constants.O_RDWR | constants.O_APPEND | constants.O_NOFOLLOW,
    );
    this.compactedAt = Date.now();
  }

  async ready() {
    try {
      await this.serialize(async () => {
        this.initialized ??= this.initialize();
        await this.initialized;
      });
    } catch (error) {
      throw new MarketSourceStorageError('Tushare quota ownership or journal is unavailable', {
        cause: error,
      });
    }
  }

  private async append(value: object) {
    if (this.ledger) {
      try {
        if (Date.now() - this.compactedAt > 3_600_000) {
          await this.compact();
        }
        await this.ledger!.appendFile(JSON.stringify(value) + '\n');
        await this.ledger!.sync();
      } catch (error) {
        throw new MarketSourceStorageError('Unable to reserve Tushare quota', { cause: error });
      }
    }
  }

  async acquire(api: string, signal?: AbortSignal): Promise<() => void> {
    for (;;) {
      if (signal?.aborted) {
        throw new MarketSyncBudgetError();
      }
      const result = await this.serialize(async () => {
        if (this.closed) {
          throw new MarketSyncBudgetError('Tushare admission is closed');
        }
        this.initialized ??= this.initialize().catch((error: unknown) => {
          throw new MarketSourceStorageError('Tushare quota ownership or journal is unavailable', {
            cause: error,
          });
        });
        await this.initialized;
        if (signal?.aborted || this.closed) {
          throw new MarketSyncBudgetError();
        }
        const now = Date.now();
        this.reservations = this.reservations.filter((entry) => entry.at > now - 86_400_000);
        const quota = this.options.apiLimits?.[api];
        const minute = this.reservations.filter((entry) => entry.at > now - 60_000);
        const ownMinute = minute.filter((entry) => entry.api === api);
        const day = quota?.perDay ? this.reservations.filter((entry) => entry.api === api) : [];
        let until = Math.max(this.nextAt, this.cooldownUntil);
        if (minute.length >= this.options.perMinute) {
          until = Math.max(until, minute[minute.length - this.options.perMinute].at + 60_000);
        }
        if (quota && ownMinute.length >= quota.perMinute) {
          until = Math.max(until, ownMinute[ownMinute.length - quota.perMinute].at + 60_000);
        }
        if (quota?.perDay && day.length >= quota.perDay) {
          until = Math.max(until, day[day.length - quota.perDay].at + 86_400_000);
        }
        if (until > now || this.active >= this.options.concurrency) {
          return { wait: Math.max(1, Math.min(until > now ? until - now : 50, 30_000)) };
        }
        await this.append({ api, at: now });
        this.reservations.push({ api, at: now });
        this.nextAt = Date.now() + this.options.minIntervalMs;
        this.active++;
        let released = false;

        return {
          release: () => {
            if (!released) {
              released = true;
              this.active--;
              this.wake();
            }
          },
        };
      });
      if ('release' in result && result.release) {
        return result.release;
      }
      await this.wait(result.wait ?? 1, signal);
    }
  }

  async cooldown(milliseconds: number) {
    await this.serialize(async () => {
      this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + milliseconds);
      await this.append({ at: Date.now(), cooldownUntil: this.cooldownUntil });
      this.wake();
    });
  }

  private wake() {
    for (const wake of [...this.wakes]) {
      wake();
    }
  }

  private wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.wakes.delete(finish);
        signal?.removeEventListener('abort', abort);
      };
      const finish = () => {
        cleanup();
        resolve();
      };
      const abort = () => {
        cleanup();
        reject(new MarketSyncBudgetError());
      };
      const timer = setTimeout(finish, milliseconds);
      this.wakes.add(finish);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) {
        abort();
      }
    });
  }

  async close() {
    this.closed = true;
    this.wake();
    await this.tail;
    while (this.active) {
      await this.wait(50);
    }
    await this.ledger?.close();
    this.ledger = undefined;
    await this.owner?.close();
    this.owner = undefined;
  }
}
