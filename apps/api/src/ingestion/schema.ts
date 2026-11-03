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

const unitSchema = z.object({
  dataset: z.string(),
  scope: z.string(),
  period: z.string(),
  api: z.string(),
  refresh: z.boolean(),
  startDate: z.string(),
  endDate: z.string(),
  fullHistory: z.boolean().optional(),
  exchanges: z.array(z.string()).readonly().optional(),
  catalogThrough: z.string().optional(),
});

/**
 * 固定本轮阶段计划及已确认的报告期；旧版无计划快照在恢复时建立一次。
 *
 * Freeze phase plans and discovered periods; establish a plan once for legacy runs.
 */
export const runPlanSchema = z.object({
  version: z.literal(2),
  referenceUnits: z.array(unitSchema),
  selectionUnits: z.array(unitSchema).optional(),
  catalogUnits: z.array(unitSchema).optional(),
  financialPeriods: z.record(z.string(), z.array(z.string())),
  plan: z
    .object({
      units: z.array(unitSchema),
      blocked: z.array(z.object({ dataset: z.string(), scope: z.string(), message: z.string() })),
    })
    .optional(),
});

export type IngestionRunPlan = z.infer<typeof runPlanSchema>;

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
  warnings: number;
}
