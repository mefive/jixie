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
  'split',
  'succeeded',
  'partial',
  'failed',
  'interrupted',
]);

export const ingestionExecutionSchema = z.object({
  succeeded: z.number(),
  partial: z.number(),
  failed: z.number(),
  rejected: z.number(),
  issues: z.number().optional(),
  warnings: z.number().optional(),
});

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
  adaptiveRange: z.literal(true).optional(),
  announcementField: z.enum(['ann_date', 'f_ann_date']).optional(),
  announcementRange: z.literal(true).optional(),
  exchanges: z.array(z.string()).readonly().optional(),
  catalogThrough: z.string().optional(),
});

/**
 * 固定本轮阶段计划；旧版报告期目录快照恢复时重建季度计划。
 *
 * Freeze phase plans and rebuild quarterly work when resuming obsolete catalog snapshots.
 */
export const runPlanSchema = z.object({
  version: z.literal(2),
  referenceUnits: z.array(unitSchema),
  selectionUnits: z.array(unitSchema).optional(),
  plan: z
    .object({
      units: z.array(unitSchema),
      blocked: z.array(z.object({ dataset: z.string(), scope: z.string(), message: z.string() })),
      statementCodes: z.array(z.string()).optional(),
      statementStrategy: z.literal('announcement_range').optional(),
    })
    .optional(),
});

export type IngestionRunPlan = z.infer<typeof runPlanSchema>;

/**
 * 旧目录计划只移除执行计划，保留运行身份和成功批次；下一步按固定季度重新规划。
 *
 * Discard obsolete catalog plans while retaining run identity and receipts for quarterly replanning.
 */
export function parseRunPlan(snapshot: unknown): IngestionRunPlan {
  const plan = runPlanSchema.parse(snapshot);
  if (
    snapshot &&
    typeof snapshot === 'object' &&
    ('catalogUnits' in snapshot || 'financialPeriods' in snapshot)
  ) {
    delete plan.plan;
  }

  return plan;
}

export interface IngestionInput {
  targetDate: string;
  source: SyncSource;
  trigger?: 'manual' | 'timer';
  signal?: AbortSignal;
  clock?: () => Date;
  onLog?: (line: string) => void;
  concurrency?: number;
  bufferBytes?: number;
}

export type IngestionRetryInput = Omit<IngestionInput, 'targetDate'>;

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
