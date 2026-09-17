import type { FactorReport as FactorReportRow } from '@prisma/client';
import type { FactorResearchSpecV1 } from '@jixie/shared';
import { normalizeFactorResearchSpec } from '../execution/spec.js';

export function reportResearchSpec(row: FactorReportRow) {
  if (row.specJson) {
    try {
      return normalizeFactorResearchSpec(JSON.parse(row.specJson));
    } catch {
      // Legacy rows still have queryable parameter columns as a safe fallback.
    }
  }

  return normalizeFactorResearchSpec({
    version: 1,
    freq: row.freq === 'week' ? 'week' : 'month',
    start: row.start,
    end: row.end,
    neutral: row.neutral === 'size' || row.neutral === 'size_industry' ? row.neutral : 'none',
  });
}

export function reportCompatibilityColumns(spec: FactorResearchSpecV1) {
  if (spec.analysisKind === 'cross_sectional') {
    return {
      freq: spec.protocol.freq,
      neutral: spec.protocol.neutral,
      start: spec.protocol.start,
      end: spec.protocol.end,
    };
  }
  const frequency = { daily: 'day', weekly: 'week', monthly: 'month' } as const;
  return {
    freq: frequency[spec.observationFrequency],
    neutral: 'none',
    start: spec.start,
    end: spec.end,
  };
}
