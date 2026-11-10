import { createDatabase, closeDatabase, withDatabase } from '#infra/database/prisma.js';
import { acceptCandidate } from './replica.js';
import { PublicationPlan } from './publication-plan.js';

/**
 * 子进程在真实主库事务写入首块后暂停，由隔离测试强杀。
 *
 * Pause the child after its first real transaction write so an isolated test can kill it.
 */
const url = process.env.DATABASE_URL;
if (!url?.includes('jixie-unified-sync-test-') || !url.endsWith('/test.db') || !process.send) {
  throw new Error('This fixture requires an isolated test database and IPC');
}
const [runId, version] = process.argv.slice(2);
const database = createDatabase(url);
const originalRead = PublicationPlan.prototype.read;
let passes = 0;
PublicationPlan.prototype.read = async function* (signal?: AbortSignal) {
  const writing = ++passes === 2;
  for await (const chunk of originalRead.call(this, signal)) {
    yield chunk;
    if (writing) {
      process.send!('transaction-wrote-first-chunk');
      await new Promise<void>(() => {});
    }
  }
};
try {
  await withDatabase(database, () => acceptCandidate(runId, version));
} finally {
  await closeDatabase(database);
}
