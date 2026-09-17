import { z } from 'zod';
import { MARKET_STATE_INDEX_CODES } from '../market-state.js';

// Instruments.
export const instrumentAssetTypeSchema = z.enum(['stock', 'etf', 'index', 'future']);

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

// State and weather.
const marketStateScopes = ['all', ...MARKET_STATE_INDEX_CODES] as const;

export const marketStateQuerySchema = z.object({
  scope: z.enum(marketStateScopes).default('all'),
});

const marketWeatherFrequencies = ['week', 'month', 'quarter', 'year'] as const;

const marketWeatherDimensions = ['industry', 'scale', 'board', 'style'] as const;

export const marketWeatherQuerySchema = z.object({
  dimension: z.enum(marketWeatherDimensions).default('industry'),
  frequency: z.enum(marketWeatherFrequencies).default('month'),
});

// Submission and lookup.
export const instrumentNamesQuerySchema = z.object({ codes: z.string().min(1) });

// HTTP input types describe values before defaults and transformations.
export type InstrumentSeriesRequestQuery = z.input<typeof instrumentSeriesQuerySchema>;
export type InstrumentAssetTypeRequestParam = z.input<typeof instrumentAssetTypeSchema>;
export type MarketStateRequestQuery = z.input<typeof marketStateQuerySchema>;
export type MarketWeatherRequestQuery = z.input<typeof marketWeatherQuerySchema>;
export type InstrumentNamesRequestQuery = z.input<typeof instrumentNamesQuerySchema>;
