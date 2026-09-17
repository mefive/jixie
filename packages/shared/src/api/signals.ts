import { z } from 'zod';

// Deployments.
export const deploymentListQuerySchema = z.object({ strategyId: z.string().min(1) });

// Actual executions.
export const actualExecutionSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }),
  z.object({
    status: z.literal('filled'),
    shares: z.number().positive(),
    price: z.number().positive(),
    fee: z.number().min(0).optional(),
    reason: z.string().trim().max(100).optional(),
    note: z.string().trim().max(500).optional(),
  }),
  z.object({
    status: z.literal('skipped'),
    reason: z.string().trim().min(1).max(100),
    note: z.string().trim().max(500).optional(),
  }),
]);

// Runs.
export const signalRunListQuerySchema = z.object({
  limit: z.coerce.number<string>().int().min(1).max(100).default(30),
});

export const signalRunJobQuerySchema = z.object({
  since: z.coerce.number<string>().int().min(0).default(0),
});

// Submission and lookup.
export const createDeploymentBodySchema = z.object({ reportId: z.string().min(1) });

// Submission and lookup.
export const submitSignalRunBodySchema = z.object({
  tradeDate: z
    .string()
    .regex(/^\d{8}$/)
    .optional(),
});

// HTTP input types describe values before defaults and transformations.
export type DeploymentListRequestQuery = z.input<typeof deploymentListQuerySchema>;
export type ActualExecutionRequest = z.input<typeof actualExecutionSchema>;
export type SignalRunListRequestQuery = z.input<typeof signalRunListQuerySchema>;
export type SignalRunJobRequestQuery = z.input<typeof signalRunJobQuerySchema>;
export type CreateDeploymentRequest = z.input<typeof createDeploymentBodySchema>;
export type SubmitSignalRunRequest = z.input<typeof submitSignalRunBodySchema>;
