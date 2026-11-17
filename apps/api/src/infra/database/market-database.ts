import pkg, { type Prisma } from '@jixie/market-db-client';
import { AsyncLocalStorage } from 'node:async_hooks';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { marketVersionFile } from './filename.js';
import { pathToFileURL } from 'node:url';

const { PrismaClient } = pkg;
export type MarketDatabase = InstanceType<typeof PrismaClient>;

interface LegacyMarketBinding {
  client(): MarketDatabase;
}
const legacyMarkets = new AsyncLocalStorage<LegacyMarketBinding | null>();

export function withLegacyMarketBinding<T>(
  binding: LegacyMarketBinding | null,
  operation: () => T,
): T {
  return legacyMarkets.run(binding, operation);
}

export function createLegacyMarketClient(filename: string): MarketDatabase {
  return new PrismaClient({ datasources: { db: { url: pathToFileURL(filename).href } } });
}

interface MarketScope {
  versionId?: string;
  database: MarketDatabase;
  writable: boolean;
  active: boolean;
}

const markets = new AsyncLocalStorage<MarketScope>();

/**
 * 市场连接与应用连接分别绑定到同一异步任务；已经释放的作用域不可复用。
 *
 * Bind market access independently of application access and reject expired scopes.
 */
export function getMarketDatabase(): MarketDatabase {
  const scope = markets.getStore();
  if (!scope) {
    const legacy = legacyMarkets.getStore();
    if (legacy) {
      return legacy.client();
    }
  }
  if (!scope?.active) {
    throw new Error('Market database scope is not active');
  }

  return scope.database;
}

/**
 * 采集与修复须在可写候选作用域中执行。
 *
 * Ingestion and repairs require a writable candidate.
 */
export function getCandidateDatabase(): MarketDatabase {
  const database = getMarketDatabase();
  if (markets.getStore() && !markets.getStore()?.writable) {
    throw new Error('A writable candidate is required');
  }

  return database;
}

/**
 * 调用者持有对应版本锁。连接释放后才可回收文件。
 *
 * The caller holds the version lock until this connection is released.
 */
export async function withMarketDatabase<Result>(
  filename: string,
  access: 'published' | 'candidate' | 'review',
  operation: () => Promise<Result>,
  versionId?: string,
): Promise<Result> {
  if (!isAbsolute(filename) || !(await lstat(filename)).isFile()) {
    throw new Error('Expected an existing regular market database file');
  }

  const writable = access === 'candidate';
  const url = pathToFileURL(filename);
  url.searchParams.set('connection_limit', '1');
  url.searchParams.set('mode', writable ? 'rw' : 'ro');
  const database = new PrismaClient({ datasources: { db: { url: url.href } } });
  const scope = { database, writable, active: true, versionId };

  try {
    if (!writable) {
      // 单连接确保 query_only 覆盖所有 Prisma 操作；封存文件也必须没有写权限。
      // A one-connection pool applies query_only throughout; a sealed file must have no write bits.
      const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        if (access === 'published' && ((await handle.stat()).mode & 0o222) !== 0) {
          throw new Error('Published market database is not sealed');
        }
      } finally {
        await handle.close();
      }
      await database.$executeRawUnsafe('PRAGMA query_only=ON');
    } else {
      if (((await lstat(filename)).mode & 0o222) === 0) {
        throw new Error('Cannot write a sealed market file');
      }
      await database.$queryRawUnsafe('PRAGMA journal_mode=WAL');
    }
    await database.$queryRawUnsafe('PRAGMA busy_timeout=5000');

    if (access === 'review') {
      // 候选仍可变化。本次调用独占单连接，以延迟读事务固定快照。
      // Hold a deferred read transaction on this invocation's dedicated connection to pin mutable data.
      await database.$executeRawUnsafe('BEGIN DEFERRED');
      try {
        const result = await markets.run(scope, operation);
        await database.$executeRawUnsafe('COMMIT');
        return result;
      } catch (error) {
        await database.$executeRawUnsafe('ROLLBACK');
        throw error;
      }
    }
    return await markets.run(scope, operation);
  } finally {
    scope.active = false;
    await database.$disconnect();
  }
}

export function boundMarketVersionId() {
  const scope = markets.getStore();
  return scope?.active ? scope.versionId : undefined;
}

/**
 * Worker 的父任务持版本锁，子线程只打开已绑定版本。
 *
 * The host pins the version while its worker reads the sealed file.
 */
export async function withWorkerMarket<Result>(
  versionId: unknown,
  operation: () => Promise<Result>,
) {
  if (versionId === undefined && legacyMarkets.getStore()) {
    return operation();
  }
  if (typeof versionId !== 'string') {
    throw new Error('Missing market version in worker input');
  }

  return withMarketDatabase(marketVersionFile(versionId), 'published', operation, versionId);
}

/**
 * 封存版或独占只读快照可直接读取；可写客户端需要建立显式事务。
 *
 * Sealed files and scoped read snapshots are already consistent; writable clients need a transaction.
 */
export async function readMarketSnapshot<Result>(
  read: (transaction: Prisma.TransactionClient) => Promise<Result>,
  options = { timeout: 120_000 },
) {
  const database = getMarketDatabase();
  if (markets.getStore()?.writable === false) {
    return read(database);
  }
  return database.$transaction(read, options);
}
