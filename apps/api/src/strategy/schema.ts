import type { z } from 'zod';
import { strategyAgentInputSchema as strategyAgentWireSchema } from '@jixie/shared/api/strategy';
import { embeddedDataReferencesSchema } from '#research/schema.js';

export const strategyAgentInputSchema = strategyAgentWireSchema.extend({
  dataReferences: embeddedDataReferencesSchema,
});

export type StrategyAgentInput = z.output<typeof strategyAgentInputSchema>;

export const strategyAgentBodySchema = strategyAgentInputSchema.omit({ id: true });
