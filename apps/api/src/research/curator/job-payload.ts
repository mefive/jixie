import { z } from 'zod';

export const researchCuratorJobPayloadSchema = z.strictObject({ runId: z.string().min(1) });

export type ResearchCuratorJobPayload = z.infer<typeof researchCuratorJobPayloadSchema>;
