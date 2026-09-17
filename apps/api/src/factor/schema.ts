import type { z } from 'zod';
import {
  factorAgentInputSchema as factorAgentWireSchema,
  factorQuestionSchema as factorQuestionWireSchema,
} from '@jixie/shared/api/factor';
import { embeddedDataReferencesSchema } from '#research/schema.js';

export const factorAgentInputSchema = factorAgentWireSchema.extend({
  dataReferences: embeddedDataReferencesSchema,
});

export type FactorAgentInput = z.output<typeof factorAgentInputSchema>;

export const factorAgentBodySchema = factorAgentInputSchema.omit({ id: true });

export const factorQuestionSchema = factorQuestionWireSchema.extend({
  dataReferences: embeddedDataReferencesSchema,
});

export type FactorQuestionInput = z.output<typeof factorQuestionSchema>;
