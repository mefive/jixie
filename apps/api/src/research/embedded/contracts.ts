import { z } from 'zod';
import { RESEARCH_EMBEDDED_LIMITS } from '@jixie/shared';

export const embeddedHostSchema = z.strictObject({
  type: z.enum(['factor', 'strategy']),
  id: z.string().trim().min(1).max(128),
});
export const embeddedDraftSchema = z.strictObject({
  source: z.string().min(1).max(RESEARCH_EMBEDDED_LIMITS.sourceCharacters),
  parameters: z
    .record(z.string().max(100), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .refine(
      (value) =>
        Buffer.byteLength(JSON.stringify(value)) <= RESEARCH_EMBEDDED_LIMITS.parametersBytes,
    ),
  inputScope: z.string().trim().min(1).max(2_000),
  reportId: z.string().trim().min(1).max(128).optional(),
});
export const embeddedCreateSchema = embeddedDraftSchema.extend({
  host: embeddedHostSchema,
  title: z.string().trim().min(1).max(120),
});
export const embeddedUpdateSchema = embeddedDraftSchema.extend({
  expectedRevision: z.number().int().positive(),
});
export const embeddedDeriveSchema = z.strictObject({
  parentVersionId: z.string().min(1).max(128),
  draft: embeddedDraftSchema.optional(),
});
export const embeddedRunSchema = z.strictObject({
  requestId: z.string().min(1).max(128),
  expectedRevision: z.number().int().positive(),
});
export const embeddedPageSchema = z.strictObject({
  cursor: z.string().max(128).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const embeddedListSchema = embeddedPageSchema.extend({
  hostType: z.enum(['factor', 'strategy']),
  hostId: z.string().min(1).max(128),
});
