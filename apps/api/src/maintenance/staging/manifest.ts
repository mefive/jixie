import { z } from 'zod';

export const manifestSchema = z.object({
  protocol: z.literal(2),
  id: z.string().regex(/^[A-Z0-9]+$/),
  command: z.enum(['daily', 'weekly', 'repair', 'sync', 'canonicalize', 'import']),
  args: z.array(z.string()),
  timestamp: z.iso.datetime(),
  date: z.string().regex(/^\d{8}$/),
  upperBound: z.string().regex(/^\d{8}$/),
  phase: z.enum(['preparing', 'ready', 'published', 'done', 'abandoned']),
  rulesHash: z.string(),
  requirementsHash: z.string(),
  snapshot: z.object({
    schemaHash: z.string(),
    baseRevision: z.number(),
    tables: z.array(z.string()),
  }),
  changes: z.array(
    z.object({ table: z.string(), count: z.number().int().nonnegative(), hash: z.string() }),
  ),
  actions: z.array(
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('signals'), tradeDate: z.string().regex(/^\d{8}$/) }),
      z.object({ kind: z.literal('weather') }),
    ]),
  ),
  completedActions: z.array(z.string()),
  publishedRevision: z.number().optional(),
  failure: z
    .object({ kind: z.enum(['source', 'other']), message: z.string(), at: z.iso.datetime() })
    .optional(),
  replacementId: z
    .string()
    .regex(/^[A-Z0-9]+$/)
    .optional(),
  cleanup: z
    .object({
      state: z.enum(['pending', 'complete']),
      reason: z.string(),
      at: z.iso.datetime(),
      bytes: z.number().nonnegative().optional(),
    })
    .optional(),
  timings: z.record(z.string(), z.number().nonnegative()).optional(),
  progress: z.json().optional(),
  result: z.json().optional(),
  audit: z.json().optional(),
});
export type StagingManifest = z.output<typeof manifestSchema>;
export type MaintenanceCommand = StagingManifest['command'];
