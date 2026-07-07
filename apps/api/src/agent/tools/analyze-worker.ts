import { parentPort, workerData } from 'node:worker_threads';
import { runAnalysisCode } from './analyze-sandbox.js';

/**
 * analyzeData execution thread — spawned per call (the host enforces the wall-clock timeout by
 * terminating us, and caps memory via resourceLimits). Input rides in via workerData; one result
 * (or error) message back, then we exit.
 */
const input = workerData as { code: string; data: Record<string, Record<string, unknown>[]> };

runAnalysisCode(input.code, input.data)
  .then((result) => parentPort!.postMessage({ ok: true, result }))
  .catch((e) =>
    parentPort!.postMessage({ ok: false, error: e instanceof Error ? e.message : String(e) }),
  );
