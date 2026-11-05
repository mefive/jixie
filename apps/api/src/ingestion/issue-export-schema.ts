import { z } from 'zod';

const identifierSchema = z.string().regex(/^[A-Za-z0-9_-]+$/);
export const issueExportInputSchema = z.object({
  runId: identifierSchema,
  issueId: identifierSchema.optional(),
  dataLocation: z.enum(['candidate', 'published']).optional(),
  code: z.object({ commit: z.string().nullable(), sourceDirty: z.boolean().nullable() }),
});
export type IssueExportInput = z.output<typeof issueExportInputSchema>;

export const issueClassificationSchema = z.enum([
  'current',
  'superseded_attempt',
  'obsolete_unit',
  'covered_by_later_run',
  'incomplete_dividend_receipt',
  'unknown_plan',
  'run_level_unknown',
]);
export type IssueClassification = z.output<typeof issueClassificationSchema>;

/**
 * 导出面向问题修复的业务契约。
 *
 * Export a business contract for issue repair.
 */
export const diagnosticBundleSchema = z.object({
  format: z.literal('jixie-ingestion-diagnostics'),
  manifest: z.object({
    exportedAt: z.string(),
    snapshotConsistency: z.literal('single_transaction'),
    code: issueExportInputSchema.shape.code,
    codeIdentityScope: z.literal('exporting_workspace_not_historical_attempts'),
    dataLocation: z.enum(['candidate', 'published']).optional(),
    marketRevision: z.number().nullable(),
    redacted: z.literal(true),
  }),
  run: z.record(z.string(), z.unknown()),
  selection: z.record(z.string(), z.unknown()),
  counts: z.record(z.string(), z.unknown()),
  items: z.array(
    z.object({
      issue: z.record(z.string(), z.unknown()),
      classification: issueClassificationSchema,
      classificationReason: z.string(),
      batch: z.record(z.string(), z.unknown()).nullable(),
      unit: z.record(z.string(), z.unknown()).nullable(),
      context: z.record(z.string(), z.unknown()),
      resolution: z.record(z.string(), z.unknown()).nullable().optional(),
      handling: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
  historicalIssues: z.array(z.record(z.string(), z.unknown())),
  repairContract: z.record(z.string(), z.unknown()),
  limitations: z.array(z.string()),
});
export type DiagnosticBundle = z.output<typeof diagnosticBundleSchema>;
