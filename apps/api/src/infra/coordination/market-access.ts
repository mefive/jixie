import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { open, realpath } from 'node:fs/promises';
import { fstatSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { isMainThread } from 'node:worker_threads';
import { BusinessError } from '../errors.js';

/**
 * 实际发布锁争用对应可重试维护响应，不依赖旧 running 记录。
 *
 * Translate live OS-lock contention into a retryable maintenance response.
 */
export class MarketAccessBusyError extends BusinessError {
  constructor() {
    super('market_publication_busy', {
      category: 'maintenance',
      messageKey: 'maintenanceInProgress',
    });
  }
}

export interface MarketLock {
  assertHeld(): void;
  release(): Promise<void>;
}

/**
 * 原生绑定只在宿主取得锁时加载，计算线程由宿主读作用域保护。
 *
 * Load the native binding only in the host; computation threads inherit host scope protection.
 */
async function flockBinding(): Promise<typeof import('fs-ext')> {
  if (!isMainThread) {
    throw new Error('Worker admission belongs to its host scope');
  }
  return (await import('fs-ext')).default;
}

type LockName = 'maintenance' | 'market-publish-intent' | 'market-access' | `owner-${string}`;
interface ReaderScope {
  active: boolean;
  references: number;
  lock: MarketLock;
}
export interface MarketReaderScope extends MarketLock {
  run<Result>(operation: () => Promise<Result>): Promise<Result>;
}
const readers = new AsyncLocalStorage<ReaderScope>();
const owners = new AsyncLocalStorage<MarketLock>();

export function isStagingDatabase(): boolean {
  const staging = process.env.JIXIE_STAGING_DATABASE;
  const formal = process.env.JIXIE_FORMAL_DATABASE_URL;
  const id = process.env.JIXIE_MAINTENANCE_CANDIDATE;
  if (!staging && !formal && !id) {
    return false;
  }
  if (
    !staging ||
    !formal ||
    !id ||
    !/^[A-Z0-9]+$/.test(id) ||
    staging !== process.env.DATABASE_URL ||
    databaseFilename(staging) !==
      resolve(dirname(databaseFilename(formal)), 'maintenance-staging', id, 'candidate.db')
  ) {
    throw new Error('Invalid isolated maintenance connection identity');
  }
  return true;
}

/**
 * 按源代码或编译布局解析 Prisma 相对路径，正式身份不随暂存库改变。
 *
 * Resolve Prisma-relative database paths in source and compiled layouts.
 */
export function databaseFilename(url = process.env.DATABASE_URL): string {
  if (!url?.startsWith('file:')) {
    throw new Error('Market coordination requires an explicit SQLite DATABASE_URL');
  }
  const schemaDirectory = fileURLToPath(
    new URL(
      import.meta.url.includes('/dist/') ? '../../../../prisma/' : '../../../prisma/',
      import.meta.url,
    ),
  );

  const filename = resolve(schemaDirectory, url.slice(5).split('?')[0]);
  try {
    return realpathSync(filename);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    return filename;
  }
}

export async function marketLockDirectory(): Promise<string> {
  return realpath(
    dirname(databaseFilename(process.env.JIXIE_FORMAL_DATABASE_URL ?? process.env.DATABASE_URL)),
  );
}

/**
 * 仅使用非阻塞系统调用重试，避免占用 Node 线程池等待持锁者。
 *
 * Retry nonblocking flock calls without occupying libuv workers while waiting.
 */
export async function acquireMarketLock(
  name: LockName,
  shared = false,
  timeout = 0,
): Promise<MarketLock> {
  if (!/^(maintenance|market-publish-intent|market-access|owner-[a-zA-Z0-9]+)$/.test(name)) {
    throw new Error('Invalid coordination lock name');
  }
  const directory = await marketLockDirectory();
  const fsExt = await flockBinding();
  const handle = await open(resolve(directory, `${name}.lock`), 'a+', 0o600);
  const deadline = performance.now() + timeout;
  let active = false;
  try {
    for (;;) {
      try {
        fsExt.flockSync(handle.fd, shared ? 'shnb' : 'exnb');
        active = true;
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (!['EAGAIN', 'EWOULDBLOCK', 'EACCES'].includes(code ?? '')) {
          throw error;
        }
        if (performance.now() >= deadline) {
          throw new MarketAccessBusyError();
        }
        await delay(25);
      }
    }
  } catch (error) {
    await handle.close();
    throw error;
  }

  return {
    assertHeld() {
      if (!active) {
        throw new Error('Coordination scope has already released its lock');
      }
    },
    async release() {
      if (!active) {
        return;
      }
      active = false;
      try {
        fsExt.flockSync(handle.fd, 'un');
      } finally {
        await handle.close();
      }
    },
  };
}

/**
 * P 共享准入后取得 R，关闭检查与登记之间的竞态窗口。
 *
 * Acquire shared P then shared R to close the admission/registration race.
 */
export async function acquireMarketReader(): Promise<MarketLock> {
  if (process.env.JIXIE_MARKET_ACCESS_LOCK_FD) {
    if (!process.env.JIXIE_MAINTENANCE_LOCK_FD || !process.env.JIXIE_MARKET_PUBLISH_LOCK_FD) {
      throw new Error('Inherited publication requires the complete M/P/R descriptor set');
    }
    const maintenance = await acquireInheritedOwner('maintenance', 'JIXIE_MAINTENANCE_LOCK_FD');
    const intent = await acquireInheritedOwner(
      'market-publish-intent',
      'JIXIE_MARKET_PUBLISH_LOCK_FD',
    );
    try {
      return await acquireInheritedOwner('market-access', 'JIXIE_MARKET_ACCESS_LOCK_FD');
    } finally {
      await intent.release();
      await maintenance.release();
    }
  }
  const intent = await acquireMarketLock('market-publish-intent', true);
  try {
    return await acquireMarketLock('market-access', true);
  } finally {
    await intent.release();
  }
}

export async function withMarketAccess<Result>(operation: () => Promise<Result>): Promise<Result> {
  if (readers.getStore()?.active || isStagingDatabase()) {
    return operation();
  }
  const scope = await acquireMarketScope();
  try {
    return await scope.run(operation);
  } finally {
    await scope.release();
  }
}

/**
 * 部署可传递实际继承的 FD；重新验证 inode 并加锁，而非信任环境标志。
 *
 * Adopt a deployment descriptor only after inode verification and real flock acquisition.
 */
async function acquireMaintenanceOwner(): Promise<MarketLock> {
  if (!process.env.JIXIE_MAINTENANCE_LOCK_FD) {
    return acquireMarketLock('maintenance');
  }
  return acquireInheritedOwner('maintenance', 'JIXIE_MAINTENANCE_LOCK_FD');
}

async function acquireInheritedOwner(name: LockName, variable: string): Promise<MarketLock> {
  const inherited = process.env[variable];
  const descriptor = Number(inherited);
  if (!Number.isInteger(descriptor) || descriptor < 3) {
    throw new Error('Invalid inherited maintenance descriptor');
  }
  const fsExt = await flockBinding();
  const expected = await open(resolve(await marketLockDirectory(), `${name}.lock`), 'a+', 0o600);
  try {
    const actual = fstatSync(descriptor);
    const wanted = await expected.stat();
    if (actual.dev !== wanted.dev || actual.ino !== wanted.ino) {
      throw new Error('Inherited maintenance descriptor belongs to another database');
    }
    fsExt.flockSync(descriptor, 'exnb');
  } finally {
    await expected.close();
  }
  let active = true;

  return {
    assertHeld() {
      if (!active) {
        throw new Error('Inherited maintenance scope is closed');
      }
      fstatSync(descriptor);
    },
    async release() {
      active = false;
    },
  };
}

export async function withMaintenanceLock<Result>(
  operation: () => Promise<Result>,
): Promise<Result> {
  if (readers.getStore()?.active) {
    throw new Error('Cannot upgrade a market reader to maintenance ownership');
  }
  const current = owners.getStore();
  if (current) {
    current.assertHeld();
    return operation();
  }
  const lock = await acquireMaintenanceOwner();
  try {
    return await owners.run(lock, operation);
  } finally {
    await lock.release();
  }
}

export function assertMaintenanceOwner(): void {
  const lock = owners.getStore();
  if (!lock) {
    throw new Error('Maintenance requires actual coordinator ownership');
  }
  lock.assertHeld();
}

export async function withMarketPublication<Result>(
  operation: () => Promise<Result>,
): Promise<Result> {
  assertMaintenanceOwner();
  const configuredTimeout = Number(process.env.MAINTENANCE_JOB_DRAIN_TIMEOUT_MS);
  const timeout =
    Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 120_000;
  const intent = process.env.JIXIE_MARKET_PUBLISH_LOCK_FD
    ? await acquireInheritedOwner('market-publish-intent', 'JIXIE_MARKET_PUBLISH_LOCK_FD')
    : await acquireMarketLock('market-publish-intent', false, timeout);
  try {
    const access = process.env.JIXIE_MARKET_ACCESS_LOCK_FD
      ? await acquireInheritedOwner('market-access', 'JIXIE_MARKET_ACCESS_LOCK_FD')
      : await acquireMarketLock('market-access', false, timeout);
    try {
      return await operation();
    } finally {
      await access.release();
    }
  } finally {
    await intent.release();
  }
}

export async function isMarketPublicationActive(): Promise<boolean> {
  try {
    const lock = await acquireMarketLock('market-publish-intent', true);
    await lock.release();
    return false;
  } catch (error) {
    if (error instanceof MarketAccessBusyError) {
      return true;
    }
    throw error;
  }
}

/**
 * 后台任务保留独立引用，HTTP 返回不会提前释放它仍在使用的数据版本。
 *
 * Retain a reader reference so detached work survives its originating HTTP scope.
 */
export async function acquireMarketScope(): Promise<MarketReaderScope> {
  const current = readers.getStore();
  const scope: ReaderScope = current?.active
    ? current
    : {
        active: true,
        references: 0,
        lock: isStagingDatabase()
          ? { assertHeld() {}, async release() {} }
          : await acquireMarketReader(),
      };
  scope.references++;
  let retained = true;

  return {
    assertHeld() {
      if (!retained || !scope.active) {
        throw new Error('Market reader scope is closed');
      }
    },
    async run(operation) {
      if (!retained || !scope.active) {
        throw new Error('Market reader scope is closed');
      }
      return readers.run(scope, operation);
    },
    async release() {
      if (!retained) {
        return;
      }
      retained = false;
      if (--scope.references === 0) {
        scope.active = false;
        await scope.lock.release();
      }
    },
  };
}

export async function withRetainedMarketAccess<Result>(
  operation: () => Promise<Result>,
): Promise<Result> {
  const scope = await acquireMarketScope();
  try {
    return await scope.run(operation);
  } finally {
    await scope.release();
  }
}

/** 跨进程工作所有权使用稳定摘要，兼容业务 ID。 / Hash business IDs into stable cross-process ownership names. */
export async function acquireWorkOwner(kind: string, id: string): Promise<MarketLock> {
  return acquireMarketLock(`owner-${createHash('sha256').update(`${kind}:${id}`).digest('hex')}`);
}

export async function isMaintenanceOwnerActive(): Promise<boolean> {
  try {
    const lock = await acquireMarketLock('maintenance', true);
    await lock.release();
    return false;
  } catch (error) {
    if (error instanceof MarketAccessBusyError) {
      return true;
    }
    throw error;
  }
}

/**
 * 排队调度不继承唤醒请求的读权限，真正启动每项工作时重新准入。
 *
 * Queued dispatch must acquire fresh admission rather than inherit its waking request's scope.
 */
export function runOutsideMarketAccess<Result>(operation: () => Result): Result {
  return owners.exit(() => readers.exit(operation));
}
