import { FactorError } from '../errors.js';
import type { FactorReport as FactorReportRow } from '@prisma/client';
import type { FactorResearchSpecV1 } from '@jixie/shared';
import { normalizeFactorResearchSpec } from '../analysis/spec.js';

/**
 * 从报告中恢复冻结研究规格，供复核与后续准入判断。
 *
 * Recover the frozen research specification stored in a report.
 */
export function reportResearchSpec(
  row: Pick<FactorReportRow, 'specJson' | 'freq' | 'neutral' | 'start' | 'end'> & {
    factorCodeSnapshot?: string | null;
  },
) {
  if (isRetiredCompositeReport(row)) {
    throw new FactorError('evaluation_not_found');
  }

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

/**
 * 识别已退役的组合报告，避免以普通单因子规格回退读取。
 *
 * Identify retired composite reports so they cannot fall back to ordinary single-factor settings.
 */
export function isRetiredCompositeReport(row: {
  specJson: string | null;
  factorCodeSnapshot?: string | null;
}): boolean {
  for (const text of [row.specJson, row.factorCodeSnapshot]) {
    if (!text) {
      continue;
    }

    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      continue;
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      continue;
    }

    const record = value as Record<string, unknown>;
    const protocol =
      record.protocol && typeof record.protocol === 'object'
        ? (record.protocol as Record<string, unknown>)
        : undefined;

    if (
      record.kind === 'composite' ||
      record.kind === 'panel_composite' ||
      record.version === 4 ||
      'composite' in record ||
      protocol?.version === 4 ||
      (protocol && 'composite' in protocol)
    ) {
      return true;
    }
  }

  return false;
}
