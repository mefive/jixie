import type { LogLine } from '@jixie/shared';

const logsByJob = new Map<string, LogLine[]>();
const LOG_TTL_MS = 5 * 60_000;

export function initializeJobLogs(jobId: string): void {
  logsByJob.set(jobId, []);
}

export function appendLog(jobId: string, entry: LogLine): void {
  logsByJob.get(jobId)?.push(entry);
}

export function getLiveJobLogs(jobId: string): LogLine[] | undefined {
  return logsByJob.get(jobId);
}

export function readJobLogs(jobId: string, persisted: string | null): LogLine[] {
  return logsByJob.get(jobId) ?? parsePersistedLogs(persisted);
}

export function scheduleJobLogEviction(jobId: string): void {
  setTimeout(() => logsByJob.delete(jobId), LOG_TTL_MS).unref?.();
}

function parsePersistedLogs(raw: string | null): LogLine[] {
  if (!raw) {
    return [];
  }
  try {
    return JSON.parse(raw) as LogLine[];
  } catch {
    return [];
  }
}
