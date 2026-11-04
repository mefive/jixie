import { z } from 'zod';

export const resolutionStatusSchema = z.enum(['pending', 'resolved', 'accepted']);
const scalarSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const fieldsSchema = z
  .record(z.string(), scalarSchema)
  .refine((fields) => Object.keys(fields).length > 0);
export const resolutionRowsSchema = z
  .array(
    z.object({
      table: z.string().min(1),
      key: fieldsSchema,
      values: fieldsSchema,
    }),
  )
  .min(1)
  .max(100);

/**
 * 修复调用方在同一事务核对旧值、写业务行并递增 revision 后登记处理结果。
 *
 * A repair caller verifies old values, writes rows and bumps revision in the same transaction before recording handling.
 */
export const recordIssueResolutionSchema = z.discriminatedUnion('status', [
  z.object({
    issueId: z.string().min(1),
    status: z.literal('resolved'),
    reason: z.string().trim().min(1).max(4000),
    evidence: z.array(z.string().min(1)).min(1).max(100),
    before: resolutionRowsSchema,
    after: resolutionRowsSchema,
    marketRevision: z.number().int().nonnegative(),
    previousResolutionUpdatedAt: z.string().datetime().optional(),
  }),
  z.object({
    issueId: z.string().min(1),
    status: z.literal('accepted'),
    reason: z.string().trim().min(1).max(4000),
    evidence: z.array(z.string().min(1)).min(1).max(100),
    marketRevision: z.number().int().nonnegative(),
    previousResolutionUpdatedAt: z.string().datetime().optional(),
  }),
]);
export type RecordIssueResolutionInput = z.output<typeof recordIssueResolutionSchema>;
export type ResolutionRows = z.output<typeof resolutionRowsSchema>;
