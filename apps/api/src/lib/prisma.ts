// @prisma/client 6.x is still CJS. Strict ESM in Node disallows named imports from CJS,
// so we take the default export and destructure it — works in both dev (tsx) and after build.
import pkg from '@prisma/client';

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
