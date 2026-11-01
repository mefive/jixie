export interface IngestionStatus {
  active: boolean;
  running: boolean;
  phase: 'idle' | 'preparing' | 'publishing' | 'error' | 'uninitialized';
  runId: string | null;
  kind: 'ingestion' | 'deploy' | null;
  targetDate: string | null;
  stage: string | null;
  startedAt: string | null;
  heartbeatAt: string | null;
  error: string | null;
  retryAfterSeconds: number;
  revision: number;
}
