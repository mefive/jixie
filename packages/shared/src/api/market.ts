import { z } from 'zod';

// Instruments.
export const instrumentAssetTypeSchema = z.enum(['stock', 'etf', 'index']);

export const instrumentSeriesQuerySchema = z.object({
  start: z
    .string()
    .regex(/^\d{8}$/)
    .optional(),
  end: z
    .string()
    .regex(/^\d{8}$/)
    .optional(),
});

// Submission and lookup.
export const instrumentNamesQuerySchema = z.object({ codes: z.string().min(1) });

// HTTP input types describe values before defaults and transformations.
export type InstrumentSeriesRequestQuery = z.input<typeof instrumentSeriesQuerySchema>;
export type InstrumentAssetTypeRequestParam = z.input<typeof instrumentAssetTypeSchema>;
export type InstrumentNamesRequestQuery = z.input<typeof instrumentNamesQuerySchema>;
