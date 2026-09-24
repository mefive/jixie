import type { LogLine } from '@jixie/shared';

export type LogWriter = (entry: LogLine) => void;
const LOG_TTL_MS = 5 * 60_000;

export class JobLogs {
  private static readonly instance = new JobLogs();
  private readonly buffers = new Map<string, { entries: LogLine[]; frozen: boolean }>();
  private readonly evictionTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private constructor() {}

  public static initialize(jobId: string): void {
    const { buffers } = JobLogs.instance;
    if (!buffers.has(jobId)) {
      buffers.set(jobId, { entries: [], frozen: false });
    }
  }

  public static append(jobId: string, entry: LogLine): void {
    const buffer = JobLogs.instance.buffers.get(jobId);
    if (buffer && !buffer.frozen) {
      buffer.entries.push({ ...entry });
    }
  }

  public static getLive(jobId: string): LogLine[] | undefined {
    return JobLogs.instance.buffers.get(jobId)?.entries.slice();
  }

  public static snapshot(jobId: string): string {
    return JSON.stringify(JobLogs.getLive(jobId) ?? []);
  }

  public static freeze(jobId: string, snapshot: string): void {
    JobLogs.instance.buffers.set(jobId, {
      entries: JobLogs.parsePersisted(snapshot),
      frozen: true,
    });
    JobLogs.instance.scheduleEviction(jobId);
  }

  public static read(jobId: string, persisted: string | null): LogLine[] {
    return JobLogs.getLive(jobId) ?? JobLogs.parsePersisted(persisted);
  }

  private scheduleEviction(jobId: string): void {
    const previous = this.evictionTimers.get(jobId);
    if (previous) {
      clearTimeout(previous);
    }
    const timer = setTimeout(() => {
      this.buffers.delete(jobId);
      this.evictionTimers.delete(jobId);
    }, LOG_TTL_MS);
    timer.unref?.();
    this.evictionTimers.set(jobId, timer);
  }

  private static parsePersisted(raw: string | null): LogLine[] {
    if (!raw) {
      return [];
    }
    try {
      return JSON.parse(raw) as LogLine[];
    } catch {
      return [];
    }
  }
}
