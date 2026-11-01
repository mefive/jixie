import { z } from 'zod';
import type { MarketPartition } from '#market/synchronization/partition.js';
import type { SyncSource } from '#market/synchronization/source.js';

export const runStatusSchema = z.enum([
  'running',
  'completed',
  'completed_with_issues',
  'interrupted',
  'failed',
]);
export const batchStatusSchema = z.enum([
  'running',
  'succeeded',
  'partial',
  'failed',
  'interrupted',
]);

export interface IngestionUnit extends MarketPartition {
  period: string;
  api: string;
  refresh: boolean;
}

export interface IngestionInput {
  targetDate: string;
  source: SyncSource;
  trigger?: 'manual' | 'timer';
  signal?: AbortSignal;
  clock?: () => Date;
  onLog?: (line: string) => void;
}

export interface IngestionResult {
  runId: string;
  targetDate: string;
  status: z.infer<typeof runStatusSchema>;
  batches: number;
  succeeded: number;
  partial: number;
  failed: number;
  accepted: number;
  filtered: number;
  rejected: number;
  issues: number;
}
