import { z } from 'zod';

export const ingestionRunParamsSchema = z.object({
  runId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
});
export const acceptIngestionCandidateSchema = z.strictObject({
  expectedCandidateVersion: z.string().regex(/^[a-f0-9]{64}$/),
});
export type IngestionRunParams = z.input<typeof ingestionRunParamsSchema>;
export type AcceptIngestionCandidateRequest = z.input<typeof acceptIngestionCandidateSchema>;

export type IngestionExecutionSummary = {
  succeeded: number;
  partial: number;
  failed: number;
  rejected: number;
  issues?: number;
  warnings?: number;
};

export interface IngestionCandidateReview {
  runId: string;
  targetDate: string;
  phase: string | null;
  status: string;
  pending: number;
  candidateVersion: string;
  finishedAt: string | null;
  execution: IngestionExecutionSummary | null;
}

export interface IngestionCandidatePublication {
  mode: 'published' | 'already_published';
  runId: string;
  revision: number;
}

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
    execution: IngestionExecutionSummary | null;
    handling: IssueHandlingCounts;
  } | null;
  handling: IssueHandlingCounts;
  unknownValidity: number;
  coveredHistorical: number;
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
    status: 'pending' | 'review' | 'resolved' | 'accepted';
    verification: 'verified' | 'changed' | 'unknown' | null;
    handlingReason: string | null;
    resolvedAt: string | null;
  }>;
}

export interface IngestionPublishingStatus {
  active: true;
  phase: 'publishing';
  retryAfterSeconds: number;
}

export interface IngestionAvailableStatus {
  active: false;
  running: boolean;
  phase: 'idle' | 'preparing' | 'error' | 'uninitialized';
  runId: string | null;
  kind: 'ingestion' | null;
  targetDate: string | null;
  stage: string | null;
  startedAt: string | null;
  heartbeatAt: string | null;
  error: string | null;
  retryAfterSeconds: number;
  revision: number;
  health: IngestionHealth;
  candidate?: { runId: string; targetDate: string; phase: string | null };
}

export type IngestionStatus = IngestionAvailableStatus | IngestionPublishingStatus;
