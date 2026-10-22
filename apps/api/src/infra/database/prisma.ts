import pkg from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';

const { PrismaClient } = pkg;
export type Prisma = InstanceType<typeof PrismaClient>;
const databases = new AsyncLocalStorage<Prisma>();
const managed = new WeakSet<Prisma>();
const closed = new WeakSet<Prisma>();
const initialization = new WeakMap<Prisma, Promise<void>>();

/**
 * 创建由调用方管理生命周期的数据库连接，不识别任何业务或进程角色。
 *
 * Create a caller-owned database client without business or process-role knowledge.
 */
export function createDatabase(url?: string): Prisma {
  const database = new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
  managed.add(database);

  return database;
}

/** 主程序复用单一连接；业务通过执行作用域获取连接。 / Reuse one application client; business code resolves its execution scope. */
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

  return await databases.run(database, operation);
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
  await database.$disconnect();
}
