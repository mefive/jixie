import { z } from 'zod';

export interface IssueHandlingCounts {
  pending: { error: number; warning: number };
  resolved: { error: number; warning: number };
  accepted: { error: number; warning: number };
}

export interface IngestionHealth {
  latestRun: {
    id: string;
    status: string;
    targetDate: string;
    finishedAt: string | null;
    execution: {
      succeeded: number;
      partial: number;
      failed: number;
      rejected: number;
      issues?: number;
      warnings?: number;
    } | null;
    handling: IssueHandlingCounts;
  } | null;
  handling: IssueHandlingCounts;
  unknownValidity: number;
  missingResolutionRecords: number;
}

export const ingestionIssueListQuerySchema = z.object({
  offset: z.coerce.number<string>().int().min(0).default(0),
  limit: z.coerce.number<string>().int().min(1).max(100).default(20),
});
export type IngestionIssueListInput = z.output<typeof ingestionIssueListQuerySchema>;
export type IngestionIssueListQuery = z.input<typeof ingestionIssueListQuerySchema>;

export interface IngestionIssueList {
  total: number;
  offset: number;
  limit: number;
  items: Array<{
    id: string;
    runId: string;
    targetDate: string;
    severity: 'error' | 'warning';
    dataset: string | null;
    scope: string | null;
    period: string | null;
    businessKey: string | null;
    reasonCode: string;
    message: string;
    status: 'pending' | 'resolved' | 'accepted';
    verification: 'verified' | 'changed' | 'unknown' | null;
    handlingReason: string | null;
    resolvedAt: string | null;
  }>;
}

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
  health: IngestionHealth;
}
