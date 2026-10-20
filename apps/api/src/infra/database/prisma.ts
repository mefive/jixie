// @prisma/client 6.x is still CJS. Strict ESM in Node disallows named imports from CJS,
// so we take the default export and destructure it — works in both dev (tsx) and after build.
import pkg from '@prisma/client';
import { isMainThread } from 'node:worker_threads';
import { acquireMarketLock, isStagingDatabase } from '../coordination/market-access.js';

// 每个候选写进程独立持有所有权引用，父进程退出后不能误用仍活动的候选。
// Every candidate writer retains ownership so recovery cannot reuse files with a live descendant.
const stagingDatabase = isStagingDatabase();
const stagingOwner =
  stagingDatabase && isMainThread
    ? await acquireMarketLock(`owner-${process.env.JIXIE_MAINTENANCE_CANDIDATE}`, true)
    : undefined;
const parentDisconnected = () => process.exit(1);
if (stagingOwner && isMainThread && process.connected) {
  process.once('disconnect', parentDisconnected);
}
process.once('beforeExit', () => {
  void stagingOwner?.release();
});

/** 正常退出先移除父进程故障监听。 / Detach the failure handler before normal IPC shutdown. */
export function closeStagingIPC(): void {
  process.removeListener('disconnect', parentDisconnected);
  if (process.connected) {
    process.disconnect();
  }
}

const { PrismaClient } = pkg;

export const prisma = new PrismaClient();
export type Prisma = typeof prisma;

// SQLite: WAL lets concurrent readers (backtest worker threads) and the HTTP-thread writer coexist
// without throwing SQLITE_BUSY; busy_timeout adds retry grace on the rare lock contention. journal_mode
// is a persisted DB-level setting, busy_timeout is per-connection — so every PrismaClient (the main
// thread and each worker thread imports this module → its own client) runs both on its own connection.
// Fire-and-forget at startup; both PRAGMAs return a row, so use $queryRawUnsafe.
void prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL;').catch(() => {});
void prisma.$queryRawUnsafe('PRAGMA busy_timeout=5000;').catch(() => {});
