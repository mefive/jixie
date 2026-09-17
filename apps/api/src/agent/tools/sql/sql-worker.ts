import { DatabaseSync } from 'node:sqlite';
import { parentPort, workerData } from 'node:worker_threads';

/**
 * Read-only SQL executor thread. Two hard guarantees the main thread can't give:
 *   - the connection itself is opened readOnly (SQLite refuses writes at the C level — the
 *     keyword guard in read-only-sql.ts remains as defense in depth, not as the barrier);
 *   - a runaway scan blocks THIS thread only; the host enforces the timeout by terminating us.
 * Long-lived: spawned once (lazily), one in-flight query at a time per message id.
 */
const db = new DatabaseSync(workerData.dbPath as string, { readOnly: true });

interface SqlRequest {
  id: number;
  sql: string;
}

parentPort!.on('message', (request: SqlRequest) => {
  try {
    const rows = db.prepare(request.sql).all();
    parentPort!.postMessage({ id: request.id, ok: true, rows });
  } catch (e) {
    // Only SQLite query errors are safe to report as invalid user SQL. Infrastructure failures
    // escape through the worker error channel without changing the existing response protocol.
    if (!(e instanceof Error) || !('errcode' in e) || e.errcode !== 1) {
      throw e;
    }
    parentPort!.postMessage({
      id: request.id,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
});
