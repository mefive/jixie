import { OWNER_READ_WRITE, OWNER_ONLY_DIRECTORY } from '../file-permissions.js';
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { open, realpath, lstat, unlink, readdir, mkdir } from 'node:fs/promises';
import { constants, fstatSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { databaseFilename, marketVersionFile } from '../database/filename.js';
export { databaseFilename } from '../database/filename.js';
import { getApplicationDatabase, usesMarketVersions } from '../database/prisma.js';
import { withMarketDatabase } from '../database/market-database.js';
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
  readonly descriptor?: number;
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
  versionId?: string;
  active: boolean;
  references: number;
  lock: MarketLock;
}
export interface MarketReaderScope extends MarketLock {
  run<Result>(operation: () => Promise<Result>): Promise<Result>;
}
const readers = new AsyncLocalStorage<ReaderScope>();
const owners = new AsyncLocalStorage<MarketLock>();

export async function marketLockDirectory(): Promise<string> {
  return realpath(dirname(databaseFilename(process.env.DATABASE_URL)));
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
  return acquireFileLock(resolve(directory, `${name}.lock`), name, shared, timeout);
}

/**
 * 每个版本复用稳定的锁文件；GC 只回收数据目录。
 *
 * Version locks survive version directory reclamation.
 */
export async function acquireMarketVersionLock(id: string, shared: boolean, timeout = 0) {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) {
    throw new Error('Invalid market version ID');
  }
  const directory = resolve(await marketLockDirectory(), 'market', 'locks');
  await mkdir(directory, { recursive: true, mode: OWNER_ONLY_DIRECTORY });

  return acquireFileLock(resolve(directory, `${id}.lock`), 'market-version', shared, timeout);
}

async function acquireFileLock(
  filename: string,
  name: LockName | 'market-version',
  shared: boolean,
  timeout: number,
): Promise<MarketLock> {
  const fsExt = await flockBinding();
  const ownerFile = name.startsWith('owner-');
  const deadline = performance.now() + timeout;
  let attempts = 0;
  for (;;) {
    const handle = await open(
      filename,
      constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
      OWNER_READ_WRITE,
    );
    let active = false;
    try {
      for (;;) {
        try {
          fsExt.flockSync(handle.fd, shared ? 'shnb' : 'exnb');
          active = true;
          break;
        } catch (error) {
          if (!isLockBusy(error)) {
            throw error;
          }
          if (performance.now() >= deadline) {
            throw new MarketAccessBusyError();
          }
          await delay(25);
        }
      }
      // 等待者可能打开了已经被回收的旧文件，持锁后必须重新核对路径。
      // Waiters may hold a reclaimed inode; verify the pathname after locking.
      if (ownerFile && !(await matchesLockFile(filename, handle.fd))) {
        if (++attempts >= 16) {
          throw new MarketAccessBusyError();
        }
        await handle.close();
        continue;
      }
    } catch (error) {
      await handle.close();
      throw error;
    }

    return {
      descriptor: handle.fd,
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
          // M 由父子进程共享同一描述符，close 而非 unlock 保留后代保护。
          // M shares an open-file description with children; close preserves descendant ownership.
          if (name === 'maintenance') {
            return;
          }
          fsExt.flockSync(handle.fd, 'un');
          if (ownerFile) {
            try {
              fsExt.flockSync(handle.fd, 'exnb');
              if (await matchesLockFile(filename, handle.fd)) {
                await unlink(filename);
              }
            } catch (error) {
              if (!isLockBusy(error) && (error as NodeJS.ErrnoException).code !== 'ENOENT') {
                console.warn('[ownership] cleanup deferred', filename, error);
              }
            }
          }
        } finally {
          await handle.close();
        }
      },
    };
  }
}

function isLockBusy(error: unknown): boolean {
  return ['EAGAIN', 'EWOULDBLOCK', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '');
}

async function matchesLockFile(filename: string, descriptor: number): Promise<boolean> {
  const expected = await lstat(filename).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  });
  const actual = fstatSync(descriptor);

  return Boolean(expected?.isFile() && expected.dev === actual.dev && expected.ino === actual.ino);
}

/**
 * 只回收无人持有且路径身份一致的 owner 文件。
 *
 * Reclaim only idle owner files with matching path identity.
 */
export async function cleanupOwnerLocks(
  apply: boolean,
): Promise<Array<{ file: string; result: string }>> {
  const directory = await marketLockDirectory();
  const fsExt = await flockBinding();
  const results: Array<{ file: string; result: string }> = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!/^owner-[a-zA-Z0-9]+\.lock$/.test(entry.name)) {
      continue;
    }
    if (!entry.isFile()) {
      results.push({ file: entry.name, result: 'unknown-file' });
      continue;
    }
    const filename = resolve(directory, entry.name);
    let handle;
    try {
      handle = await open(filename, constants.O_RDWR | constants.O_NOFOLLOW);
      fsExt.flockSync(handle.fd, 'exnb');
      if (!(await matchesLockFile(filename, handle.fd))) {
        results.push({ file: entry.name, result: 'replaced' });
        continue;
      }
      if (apply) {
        await unlink(filename);
      }
      results.push({ file: entry.name, result: apply ? 'removed' : 'removable' });
    } catch (error) {
      results.push({
        file: entry.name,
        result: isLockBusy(error) ? 'active' : (error as Error).message,
      });
    } finally {
      await handle?.close();
    }
  }

  return results;
}

/**
 * 仅将已验证的 M 描述符传给本轮子进程。
 *
 * Pass only the verified M descriptor to this run's children.
 */
export function maintenanceLockDescriptor(): number {
  const owner = owners.getStore();
  owner?.assertHeld();
  if (owner?.descriptor === undefined) {
    throw new Error('Maintenance descriptor is unavailable');
  }

  return owner.descriptor;
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
  if (readers.getStore()?.active) {
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
  const expected = await open(
    resolve(await marketLockDirectory(), `${name}.lock`),
    'a+',
    OWNER_READ_WRITE,
  );
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
    descriptor,
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

async function openReaderScope(requiredVersion?: string): Promise<ReaderScope> {
  if (!usesMarketVersions()) {
    if (requiredVersion) {
      throw new Error('Versioned job requires a versioned database');
    }
    return { active: true, references: 0, lock: await acquireMarketReader() };
  }

  // 整个任务保留部署屏障。普通发布只锁定指针，旧版本任务不阻塞发布。
  // Retain the deployment barrier for the task. Normal publication only locks the pointer.
  const deployment = await acquireMarketLock('market-publish-intent', true);
  try {
    const admission = await acquireMarketLock('market-access', true, 120_000);
    try {
      const publication = await getApplicationDatabase().marketPublication.findUniqueOrThrow({
        where: { key: 'global' },
      });
      const versionId = requiredVersion ?? publication.currentVersionId;
      if (!versionId) {
        throw new Error('No published market baseline');
      }
      const pin = await acquireMarketVersionLock(versionId, true);
      return {
        versionId,
        active: true,
        references: 0,
        lock: {
          assertHeld() {
            deployment.assertHeld();
            pin.assertHeld();
          },
          async release() {
            try {
              await pin.release();
            } finally {
              await deployment.release();
            }
          },
        },
      };
    } finally {
      await admission.release();
    }
  } catch (error) {
    await deployment.release();
    throw error;
  }
}

/**
 * 后台任务保留独立引用，HTTP 返回不会提前释放它仍在使用的数据版本。
 *
 * Retain a reader reference so detached work survives its originating HTTP scope.
 */
export async function acquireMarketScope(requiredVersion?: string): Promise<MarketReaderScope> {
  const current = readers.getStore();
  if (current?.active && requiredVersion && current.versionId !== requiredVersion) {
    throw new Error('Conflicting pinned market version');
  }
  const scope = current?.active ? current : await openReaderScope(requiredVersion);
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
      const id = scope.versionId;
      if (id) {
        return readers.run(scope, () =>
          withMarketDatabase(marketVersionFile(id), 'published', operation, id),
        );
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

/**
 * 跨进程工作所有权使用稳定摘要，兼容业务 ID。
 *
 * Hash business IDs into stable cross-process ownership names.
 */
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
