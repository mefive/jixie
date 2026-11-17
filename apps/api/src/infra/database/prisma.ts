import pkg from '@prisma/client';
import application from '@jixie/app-db-client';
import { databaseFilename } from './filename.js';
import {
  createLegacyMarketClient,
  withLegacyMarketBinding,
  type MarketDatabase,
} from './market-database.js';
import { AsyncLocalStorage } from 'node:async_hooks';

const { PrismaClient } = pkg;
export type Prisma = InstanceType<typeof PrismaClient>;
const databases = new AsyncLocalStorage<Prisma>();
const managed = new WeakMap<Prisma, string | undefined>();
const legacyMarkets = new WeakMap<Prisma, MarketDatabase>();
const versioned = new WeakSet<Prisma>();
const closed = new WeakSet<Prisma>();
export type ApplicationDatabase = InstanceType<typeof application.PrismaClient>;
const applicationClients = new WeakMap<Prisma, ApplicationDatabase>();
const initialization = new WeakMap<Prisma, Promise<void>>();

/**
 * 创建由调用方管理生命周期的数据库连接，不识别任何业务或进程角色。
 *
 * Create a caller-owned database client without business or process-role knowledge.
 */
export function createDatabase(url?: string): Prisma {
  const database = new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
  managed.set(database, url);

  return database;
}

/**
 * 主程序复用单一连接；业务通过执行作用域获取连接。
 *
 * Reuse one application client; business code resolves its execution scope.
 */
export const prisma = createDatabase();

/**
 * 绑定本次异步执行的数据库；嵌套退出恢复外层，连接由创建者关闭。
 *
 * Bind an asynchronous execution to a database; nesting restores its parent and owners close clients.
 */
export async function withDatabase<Result>(
  database: Prisma,
  operation: () => Result,
): Promise<Awaited<Result>> {
  if (closed.has(database)) {
    throw new Error('Database connection has been closed');
  }
  if (managed.has(database)) {
    let ready = initialization.get(database);
    if (!ready) {
      ready = (async () => {
        await database.$queryRawUnsafe('PRAGMA journal_mode=WAL;');
        await database.$queryRawUnsafe('PRAGMA busy_timeout=5000;');
        const hasControlTable = await database.$queryRaw<
          Array<{ name: string }>
        >`SELECT name FROM sqlite_schema WHERE type='table' AND name='MarketPublication'`;
        if (
          hasControlTable.length &&
          (await database.marketPublication.findUnique({ where: { key: 'global' } }))
        ) {
          versioned.add(database);
        } else if (hasControlTable.length) {
          const mixed = await database.$queryRaw<
            Array<{ name: string }>
          >`SELECT name FROM sqlite_schema WHERE type='table' AND name='Daily'`;
          if (!mixed.length) {
            throw new Error(
              'Missing market publication pointer; initialize or restore this layout',
            );
          }
        }
      })().catch((error: unknown) => {
        initialization.delete(database);
        throw error;
      });
      initialization.set(database, ready);
    }
    await ready;
    if (closed.has(database)) {
      throw new Error('Database connection has been closed');
    }
  }

  const binding =
    managed.has(database) && !versioned.has(database)
      ? {
          client() {
            if (closed.has(database)) {
              throw new Error('Database connection has been closed');
            }
            let client = legacyMarkets.get(database);
            if (!client) {
              client = createLegacyMarketClient(databaseFilename(managed.get(database)));
              legacyMarkets.set(database, client);
            }
            return client;
          },
        }
      : null;

  return await databases.run(database, () => withLegacyMarketBinding(binding, operation));
}

/**
 * 在函数执行时读取连接，未绑定或已关闭时拒绝访问，不回退其他数据库。
 *
 * Resolve the client at execution time and reject missing or closed scopes without fallback.
 */
export function getDatabase(): Prisma {
  const database = databases.getStore();
  if (!database || closed.has(database)) {
    throw new Error('An active database execution scope is required');
  }

  return database;
}

/**
 * 关闭连接并使继承此连接的延迟任务失效；不影响其他作用域。
 *
 * Close a client and invalidate delayed work inheriting it without changing other scopes.
 */
export async function closeDatabase(database: Prisma): Promise<void> {
  closed.add(database);
  await applicationClients.get(database)?.$disconnect();
  await legacyMarkets.get(database)?.$disconnect();
  await database.$disconnect();
}

export function usesMarketVersions(): boolean {
  const database = databases.getStore();
  return !!database && versioned.has(database);
}

/**
 * 应用查询使用不含市场模型的客户端。
 *
 * Expose only application models to user-data operations.
 */
export function getApplicationDatabase(): ApplicationDatabase {
  const owner = getDatabase();
  if (!managed.has(owner)) {
    throw new Error('Application client requires an explicitly managed database scope');
  }
  let client = applicationClients.get(owner);
  if (!client) {
    const url = managed.get(owner) ?? process.env.DATABASE_URL;
    client = new application.PrismaClient({
      datasources: { db: { url: 'file:' + databaseFilename(url) } },
    });
    applicationClients.set(owner, client);
  }

  return client;
}
