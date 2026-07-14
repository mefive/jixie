import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { FactorAnalysisSpecV1 } from '@jixie/shared';

export const factorAnalysisSpecV1Schema = z.object({
  version: z.literal(1),
  freq: z.enum(['month', 'week']),
  start: z.string().regex(/^\d{8}$/),
  end: z.string().regex(/^\d{8}$/),
  neutral: z.enum(['none', 'size', 'size_industry']).default('none'),
});

export function normalizeFactorAnalysisSpec(input: unknown): FactorAnalysisSpecV1 {
  const spec = factorAnalysisSpecV1Schema.parse(input);

  return {
    version: 1,
    freq: spec.freq,
    start: spec.start,
    end: spec.end,
    neutral: spec.neutral,
  };
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function factorVariantKey(
  spec: FactorAnalysisSpecV1,
  factorCodeHash: string,
  dataRevision: string | null = null,
): string {
  return sha256(canonicalJson({ spec, factorCodeHash, dataRevision }));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJsonValue(child)]),
    );
  }

  return value;
}
