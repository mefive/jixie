import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';

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
    parentPort!.postMessage({
      id: request.id,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
});
