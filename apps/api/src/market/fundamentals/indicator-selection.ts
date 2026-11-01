import { recordImportIssue } from '../synchronization/diagnostics.js';
import { z } from 'zod';
import { stockSourceRank, hasStockCodePredecessor } from '../instruments/stock-identity.js';
import { hasValueConflict, mergeSourceRecord } from '../synchronization/rows.js';
import type { MarketRow, SourceRecord } from '../synchronization/partition.js';

const metric = z
  .number()
  .finite()
  .nullish()
  .transform((value) => value ?? null);

export const finaIndicatorSchema = z.object({
  tsCode: z.string(),
  sourceTsCode: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  endDate: z.string(),
  annDate: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  roe: metric,
  roeWaa: metric,
  roa: metric,
  grossprofitMargin: metric,
  netprofitMargin: metric,
  debtToAssets: metric,
  orYoy: metric,
  netprofitYoy: metric,
  ocfToProfit: metric,
});

export const finaIndicatorVersionSchema = finaIndicatorSchema.extend({
  id: z.string(),
  updateFlag: z
    .string()
    .refine((value): boolean => value === '0' || value === '1')
    .nullish()
    .transform((value) => value ?? null),
  availableDate: z.string(),
  availabilityQuality: z.string(),
  sourceFingerprint: z.string(),
  observedAt: z.date(),
});

/**
 * 每个报告期先选来源，再选公告和修订；同优先级只允许缺值互补。
 *
 * Select source, announcement and revision per period; equal priorities only complement
 * missing values.
 */
export function selectIndicatorSnapshots(records: readonly SourceRecord[]) {
  const selected = new Map<string, SourceRecord>();
  const priorities = new Map<string, { source: number; version: string }>();
  const conflicts = new Set<string>();
  for (const record of records) {
    const values = finaIndicatorSchema.parse(record.values);
    const key = `${values.tsCode}/${values.endDate}`;
    const source = stockSourceRank(values.sourceTsCode);
    const revision = record.values.updateFlag === '1';
    const version = `${values.annDate ?? ''}|${revision ? '1' : '0'}`;
    const priority = priorities.get(key);
    const previous = selected.get(key);
    const lower =
      priority &&
      (source < priority.source || (source === priority.source && version < priority.version));
    if (lower) {
      continue;
    }

    const equal = priority && source === priority.source && version === priority.version;
    if (equal && previous && hasValueConflict(previous.values, values)) {
      conflicts.add(key);
      continue;
    }
    if (!equal) {
      conflicts.delete(key);
    }
    selected.set(key, {
      values: equal && previous ? mergeSourceRecord(previous.values, { values }) : values,
      authoritativeRevision: revision,
      raw: record.raw,
    });
    priorities.set(key, { source, version });
  }

  for (const key of conflicts) {
    selected.delete(key);
    recordImportIssue({
      category: 'snapshot',
      reasonCode: 'ambiguous_indicator_snapshot',
      message: `Ambiguous current indicator version ${key}`,
      businessKey: key,
      payload: records
        .filter((record) => `${record.values.tsCode}/${record.values.endDate}` === key)
        .map((record) => record.raw ?? record.values),
    });
  }

  return {
    records: [...selected.values()],
    errors: [...conflicts].map((key) => `Ambiguous current indicator version ${key}`),
  };
}

/**
 * 写入与历史读取共用接纳规则；切换来源时不拼接不同口径的字段。
 *
 * Share acceptance between writes and historical reads; source switches never mix
 * metric definitions.
 */
export function mergeIndicatorSnapshot(before: MarketRow | undefined, record: SourceRecord) {
  const incoming = finaIndicatorSchema.parse(record.values);
  if (!before) {
    return incoming;
  }
  const previous = finaIndicatorSchema.parse(before);
  const source = stockSourceRank(incoming.sourceTsCode);
  const previousSource = stockSourceRank(previous.sourceTsCode);
  if (source < previousSource) {
    return previous;
  }
  const hasAliases = hasStockCodePredecessor(incoming.tsCode);
  const switched = source > previousSource && (previous.sourceTsCode !== null || hasAliases);
  if (switched) {
    return incoming;
  }

  const merged = finaIndicatorSchema.parse(mergeSourceRecord(previous, { values: incoming }));
  if (!switched && (previous.annDate ?? '') > (merged.annDate ?? '')) {
    return previous;
  }
  if (
    !switched &&
    previous.annDate === merged.annDate &&
    !record.authoritativeRevision &&
    hasValueConflict(previous, merged)
  ) {
    throw new Error(
      `Ambiguous same-date indicator revision ${incoming.tsCode}/${incoming.endDate}`,
    );
  }

  return merged;
}
