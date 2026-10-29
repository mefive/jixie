import { createHash } from 'node:crypto';
import type { z } from 'zod';
import type { AcceptedMarketPartition, MarketRow, SourceRecord } from './partition.js';

/** 业务版本和稳定事件身份使用的规范摘要。 / Stable digest for business versions and event identities. */
export function fingerprint(row: object): string {
  return createHash('sha256')
    .update(
      JSON.stringify(Object.entries(row).sort(([left], [right]) => left.localeCompare(right))),
    )
    .digest('hex');
}

/** 缺失字段与未知 null 不擦除旧值。 / Missing fields and unknown nulls preserve known values. */
export function mergeSourceRecord(current: MarketRow | undefined, record: SourceRecord): MarketRow {
  const merged = { ...current };
  for (const [field, value] of Object.entries(record.values)) {
    if (value !== null || current?.[field] == null || record.authoritativeNulls?.includes(field)) {
      merged[field] = value;
    }
  }

  return merged;
}

/** 只比较业务值，忽略重复抓取的技术时间。 / Compare business values without retrieval timestamps. */
export function sameValues(
  left: object,
  right: object,
  ignored: readonly string[] = ['retrievedAt'],
) {
  const entries = (row: object) =>
    Object.entries(row).filter(([field]) => !ignored.includes(field));
  const previous = new Map(entries(left));

  return entries(right).every(([field, value]) => {
    const old = previous.get(field);
    return value instanceof Date
      ? old instanceof Date && old.getTime() === value.getTime()
      : old === value;
  });
}

/** 初始化单个领域写入摘要。 / Initialize one domain write summary. */
export function emptyWriteResult(): AcceptedMarketPartition {
  return {
    inserted: 0,
    updated: 0,
    deleted: 0,
    rejected: 0,
    changed: false,
    observedDates: [],
    errors: [],
  };
}

interface MergeRowsInput<Schema extends z.ZodType<object>> {
  schema: Schema;
  keys: readonly (keyof z.output<Schema> & string)[];
  records: SourceRecord[];
  existing: z.output<Schema>[];
  replace?: boolean;
  atomic?: boolean;
  transform?: (values: MarketRow, before: MarketRow | undefined) => MarketRow;
}

/**
 * 纯内存合并与显式领域 schema 校验；不查询数据库或根据表名选择 delegate。
 *
 * Merge in memory against an explicit domain schema; never query or select delegates by table name.
 */
export function mergeRows<Schema extends z.ZodType<object>>(input: MergeRowsInput<Schema>) {
  type Row = z.output<Schema>;
  const key = (row: object) => {
    const values = row as Record<string, unknown>;
    if (input.keys.some((field) => values[field] == null)) {
      throw new Error(`Missing business identity: ${input.keys.join(', ')}`);
    }
    return JSON.stringify(input.keys.map((field) => values[field]));
  };
  const known = new Map(input.existing.map((row) => [key(row), row]));
  const unique = new Map<string, SourceRecord>();
  const conflicts = new Set<string>();
  const errors: string[] = [];
  let rejected = 0;

  for (const record of input.records) {
    try {
      const identity = key(record.values);
      if (conflicts.has(identity)) {
        rejected++;
        continue;
      }
      const duplicate = unique.get(identity);
      if (duplicate) {
        if (
          !input.atomic &&
          sameValues(duplicate.values, record.values, []) &&
          sameValues(record.values, duplicate.values, [])
        ) {
          continue;
        }
        unique.delete(identity);
        conflicts.add(identity);
        rejected += 2;
        errors.push(`Duplicate or conflicting business key ${identity}`);
        continue;
      }
      unique.set(identity, record);
    } catch (error) {
      rejected++;
      errors.push(String(error));
    }
  }

  const inserted: Row[] = [];
  const updated: Row[] = [];
  const accepted = new Set<string>();
  const observedDates: string[] = [];
  for (const [identity, record] of unique) {
    try {
      const before = known.get(identity);
      const previous = before as MarketRow | undefined;
      const merged = mergeSourceRecord(previous, record);
      const values = input.schema.parse(
        input.transform ? input.transform(merged, previous) : merged,
      );
      accepted.add(identity);
      const fields = values as MarketRow;
      const date = fields.tradeDate ?? fields.calDate ?? fields.endDate ?? fields.startDate;
      if (typeof date === 'string') {
        observedDates.push(date);
      }
      if (!before) {
        inserted.push(values);
      } else if (!sameValues(before, values)) {
        updated.push(values);
      }
    } catch (error) {
      rejected++;
      errors.push(String(error));
    }
  }

  const failed = input.atomic && errors.length > 0;
  return {
    inserted: failed ? [] : inserted,
    updated: failed ? [] : updated,
    deleted:
      !errors.length && input.replace
        ? input.existing.filter((row) => !accepted.has(key(row)))
        : [],
    rejected,
    errors,
    observedDates: failed ? [] : observedDates,
  };
}

/** 领域完成写入后才累计摘要。 / Count a domain batch only after its writes succeed. */
export function collectWriteResult(
  result: AcceptedMarketPartition,
  rows: {
    inserted: object[];
    updated: object[];
    deleted: object[];
    rejected: number;
    errors: string[];
    observedDates: string[];
  },
): void {
  result.inserted += rows.inserted.length;
  result.updated += rows.updated.length;
  result.deleted += rows.deleted.length;
  result.rejected += rows.rejected;
  result.changed ||= rows.inserted.length + rows.updated.length + rows.deleted.length > 0;
  result.errors.push(...rows.errors);
  result.observedDates.push(...rows.observedDates);
}
