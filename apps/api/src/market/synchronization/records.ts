import { localDate } from './date.js';
import { createHash } from 'node:crypto';
import pkg from '@prisma/client';
import type {
  AcceptedMarketPartition,
  MarketRow,
  MarketTransaction,
  PreparedMarketPartition,
  PreparedTable,
  SourceRecord,
} from './partition.js';

/**
 * 明确白名单，不从 schema 推导公开数据面或包含用户表。
 *
 * Explicit allowlist, never a public schema inferred from Prisma or a user-table writer.
 */
const KEYS: Readonly<Record<string, readonly string[]>> = {
  TradeCal: ['exchange', 'calDate'],
  StockBasic: ['tsCode'],
  StockCodeChange: ['oldTsCode'],
  StockNameHistory: ['tsCode', 'startDate'],
  Daily: ['tsCode', 'tradeDate'],
  AdjFactor: ['tsCode', 'tradeDate'],
  DailyBasic: ['tsCode', 'tradeDate'],
  StkLimit: ['tsCode', 'tradeDate'],
  EtfBasic: ['tsCode'],
  EtfDaily: ['tsCode', 'tradeDate'],
  EtfAdjFactor: ['tsCode', 'tradeDate'],
  EtfShareSize: ['tsCode', 'tradeDate'],
  IndexWeight: ['indexCode', 'conCode', 'tradeDate'],
  IndexDaily: ['tsCode', 'tradeDate'],
  IndexDailyBasic: ['tsCode', 'tradeDate'],
  IndexBenchmark: ['tsCode'],
  YieldCurvePoint: ['source', 'curveCode', 'curveType', 'tradeDate', 'termYears'],
  FxDaily: ['tsCode', 'tradeDate'],
  MarketBenchmark: ['id'],
  MarketBenchmarkDaily: ['benchmarkId', 'tradeDate'],
  FinancialIncomeStatement: ['sourceRowFingerprint'],
  FinancialBalanceSheet: ['sourceRowFingerprint'],
  FinancialCashFlowStatement: ['sourceRowFingerprint'],
  FinaIndicator: ['tsCode', 'endDate'],
  FinaIndicatorVersion: ['sourceFingerprint'],
  Dividend: ['id'],
  MacroSeries: ['seriesKey'],
  MacroObservation: ['seriesKey', 'period', 'vintageDate'],
  MacroReleaseSchedule: ['publishDate', 'title'],
};

interface MarketDelegate {
  findMany(input: { where: Record<string, unknown> }): Promise<MarketRow[]>;
  createMany(input: { data: MarketRow[] }): Promise<unknown>;
  updateMany(input: {
    where: Record<string, unknown>;
    data: MarketRow;
  }): Promise<{ count: number }>;
  deleteMany(input: { where: Record<string, unknown> }): Promise<{ count: number }>;
}

/**
 * 动态行政持久化只针对白名单，入库前按当前内部 schema 校验。
 *
 * Administrative persistence is allowlisted and validates current internal schema before writing.
 */
function store(transaction: MarketTransaction, table: string): MarketDelegate {
  if (!KEYS[table]) {
    throw new Error(`Undeclared market table: ${table}`);
  }

  return (transaction as unknown as Record<string, MarketDelegate>)[
    table[0].toLowerCase() + table.slice(1)
  ];
}

export function rowKey(table: string, row: MarketRow): string {
  const keys = KEYS[table];
  if (!keys || keys.some((key) => row[key] == null)) {
    throw new Error(`Missing business identity for ${table}`);
  }

  return JSON.stringify(keys.map((key) => row[key]));
}

export function fingerprint(row: object): string {
  return createHash('sha256')
    .update(
      JSON.stringify(Object.entries(row).sort(([left], [right]) => left.localeCompare(right))),
    )
    .digest('hex');
}

function keyWhere(table: string, row: MarketRow): Record<string, unknown> {
  return Object.fromEntries(KEYS[table].map((key) => [key, row[key]]));
}

function validateRow(table: string, row: MarketRow): void {
  const model = pkg.Prisma.dmmf.datamodel.models.find((entry) => entry.name === table);
  if (!model) {
    throw new Error(`Missing generated Prisma model: ${table}`);
  }
  for (const [name, value] of Object.entries(row)) {
    const field = model.fields.find((entry) => entry.name === name && entry.kind !== 'object');
    if (!field || (value === null && field.isRequired)) {
      throw new Error(`Invalid ${table}.${name}`);
    }
    if (value === null) {
      continue;
    }
    const valid =
      field.type === 'DateTime'
        ? value instanceof Date && Number.isFinite(value.getTime())
        : field.type === 'Boolean'
          ? typeof value === 'boolean'
          : field.type === 'Int'
            ? typeof value === 'number' && Number.isSafeInteger(value)
            : field.type === 'Float'
              ? typeof value === 'number' && Number.isFinite(value)
              : typeof value === 'string';
    if (!valid) {
      throw new Error(`Invalid value for ${table}.${name}`);
    }
  }
  for (const field of model.fields.filter(
    (entry) =>
      entry.kind !== 'object' && entry.isRequired && !entry.hasDefaultValue && !entry.isUpdatedAt,
  )) {
    if (row[field.name] === undefined) {
      throw new Error(`Missing ${table}.${field.name}`);
    }
  }
  rowKey(table, row);
}

/**
 * 缺省或未知 null 保留旧值，明确 null 修订才能清空。
 *
 * Preserve old values for omitted/unknown fields; only authoritative nulls clear them.
 */
export function mergeSourceRecord(current: MarketRow | undefined, record: SourceRecord): MarketRow {
  const merged = { ...current };
  for (const [field, value] of Object.entries(record.values)) {
    if (value !== null || current?.[field] == null || record.authoritativeNulls?.includes(field)) {
      merged[field] = value;
    }
  }

  return merged;
}

/**
 * 数据及证据由调用者和覆盖/失效一起在同一事务内提交。
 *
 * Callers commit data and provenance with coverage and invalidation in one transaction.
 */
export async function acceptMarketPartition(
  transaction: MarketTransaction,
  partition: PreparedMarketPartition,
  dataset: string,
  fetchedAt: Date,
): Promise<AcceptedMarketPartition> {
  const result: AcceptedMarketPartition = {
    inserted: 0,
    updated: 0,
    deleted: 0,
    rejected: 0,
    observedDates: [],
    changes: [],
    errors: [],
  };
  for (const batch of partition.tables) {
    const rejectedBefore = result.rejected;
    if (batch.atomic && batch.replacementRequest && !batch.replacement) {
      result.rejected += batch.records.length;
      result.errors.push(`Unqualified atomic source extent: ${batch.table}`);
      continue;
    }
    const candidate = await validateRecordBatch(transaction, batch, result);
    if (!candidate) {
      continue;
    }
    const acceptedKeys = await mergeRecordBatch(
      transaction,
      batch,
      candidate,
      dataset,
      fetchedAt,
      result,
    );
    await deleteAuthorizedExtent(
      transaction,
      batch,
      partition,
      candidate.existing,
      acceptedKeys,
      result,
      result.rejected === rejectedBefore,
    );
  }

  return result;
}

async function validateRecordBatch(
  transaction: MarketTransaction,
  batch: PreparedTable,
  result: AcceptedMarketPartition,
): Promise<{ validRecords: SourceRecord[]; existing: MarketRow[] } | null> {
  const delegate = store(transaction, batch.table);
  const batchErrors = result.errors.length;
  const unique = new Map<string, SourceRecord>();
  const conflicts = new Set<string>();
  for (const record of batch.records) {
    try {
      const key = rowKey(batch.table, record.values);
      const previous = unique.get(key);
      if (conflicts.has(key)) {
        result.rejected++;
        continue;
      }
      if (previous) {
        if (!batch.atomic && fingerprint(previous.values) === fingerprint(record.values)) {
          continue;
        }
        unique.delete(key);
        conflicts.add(key);
        result.rejected += 2;
        result.errors.push(`Duplicate or conflicting ${batch.table} business key ${key}`);
        continue;
      }
      unique.set(key, record);
    } catch (error) {
      result.rejected++;
      result.errors.push(String(error));
    }
  }
  const validRecords = [...unique.values()];
  const existing: MarketRow[] = [];
  if (batch.replacement) {
    existing.push(...(await delegate.findMany({ where: batch.replacement.where })));
  } else {
    for (let offset = 0; offset < validRecords.length; offset += 200) {
      existing.push(
        ...(await delegate.findMany({
          where: {
            OR: validRecords
              .slice(offset, offset + 200)
              .map((record) => keyWhere(batch.table, record.values)),
          },
        })),
      );
    }
  }
  if (batch.atomic) {
    for (const record of validRecords) {
      try {
        validateRow(
          batch.table,
          mergeSourceRecord(
            existing.find((row) => rowKey(batch.table, row) === rowKey(batch.table, record.values)),
            record,
          ),
        );
      } catch (error) {
        result.rejected++;
        result.errors.push(String(error));
      }
    }
    if (result.errors.length > batchErrors) {
      return null;
    }
  }
  return { validRecords, existing };
}

async function mergeRecordBatch(
  transaction: MarketTransaction,
  batch: PreparedTable,
  candidate: { validRecords: SourceRecord[]; existing: MarketRow[] },
  dataset: string,
  fetchedAt: Date,
  result: AcceptedMarketPartition,
): Promise<Set<string>> {
  const delegate = store(transaction, batch.table);
  const { validRecords, existing } = candidate;
  const previousEvidenceByKey = new Map<
    string,
    Awaited<ReturnType<typeof transaction.marketRecordEvidence.findMany>>[number]
  >();
  for (let offset = 0; offset < validRecords.length; offset += 200) {
    const evidence = await transaction.marketRecordEvidence.findMany({
      where: {
        tableName: batch.table,
        businessKey: {
          in: validRecords
            .slice(offset, offset + 200)
            .map((record) => rowKey(batch.table, record.values)),
        },
      },
    });
    for (const entry of evidence) {
      previousEvidenceByKey.set(entry.businessKey, entry);
    }
  }
  const inserts: MarketRow[] = [];
  const existingByKey = new Map(existing.map((row) => [rowKey(batch.table, row), row]));
  const acceptedKeys = new Set<string>();
  for (const record of validRecords) {
    const key = rowKey(batch.table, record.values);
    const before = existingByKey.get(key);
    const after = mergeSourceRecord(before, record);
    if (before && (batch.table.startsWith('Financial') || batch.table === 'FinaIndicatorVersion')) {
      // 同一版本的首次观察时间和内部 ID 稳定，不因重抓而改写。
      // Keep first observation and internal identity stable when fetching the same version again.
      for (const field of ['id', 'observedAt']) {
        if (before[field] !== undefined) {
          after[field] = before[field];
        }
      }
    }
    if (before && batch.table === 'FinaIndicatorVersion') {
      after.availableDate = before.availableDate;
      if (
        before.availabilityQuality === 'unknown' &&
        after.availabilityQuality !== 'unknown' &&
        before.observedAt instanceof Date
      ) {
        const next = await transaction.tradeCal.findFirst({
          where: { exchange: 'SSE', isOpen: 1, calDate: { gt: localDate(before.observedAt) } },
          orderBy: { calDate: 'asc' },
          select: { calDate: true },
        });
        if (next) {
          after.availableDate = next.calDate;
        } else {
          after.availabilityQuality = 'unknown';
        }
      }
    }
    try {
      validateRow(batch.table, after);
    } catch (error) {
      result.rejected++;
      result.errors.push(String(error));
      continue;
    }
    acceptedKeys.add(key);
    const observation =
      after.tradeDate ??
      after.calDate ??
      after.endDate ??
      after.startDate ??
      (typeof after.period === 'string' && after.period.length === 6
        ? `${after.period}01`
        : after.period);
    if (typeof observation === 'string') {
      result.observedDates.push(observation);
    }
    const unchanged =
      before &&
      Object.entries(after).every(
        ([field, value]) =>
          field === 'retrievedAt' ||
          (value instanceof Date
            ? value.getTime() === new Date(before[field] as Date).getTime()
            : value === before[field]),
      );
    if (!unchanged) {
      if (before) {
        const updated = await delegate.updateMany({
          where: keyWhere(batch.table, before),
          data: after,
        });
        if (updated.count !== 1) {
          throw new Error(`Lost market row during publication: ${batch.table}/${key}`);
        }
        result.updated++;
      } else {
        inserts.push(after);
        result.inserted++;
      }
      result.changes.push({ table: batch.table, before: before ?? null, after });
    }
    const previousEvidence = previousEvidenceByKey.get(key);
    const valueFingerprint = fingerprint(
      Object.fromEntries(Object.entries(after).filter(([field]) => field !== 'retrievedAt')),
    );
    const previousFields =
      previousEvidence?.fieldEvidence &&
      typeof previousEvidence.fieldEvidence === 'object' &&
      !Array.isArray(previousEvidence.fieldEvidence)
        ? previousEvidence.fieldEvidence.fields
        : null;
    const fields = {
      ...(previousFields && typeof previousFields === 'object' && !Array.isArray(previousFields)
        ? previousFields
        : {}),
    };
    for (const [field, value] of Object.entries(record.values)) {
      if (
        value === null &&
        before?.[field] != null &&
        !record.authoritativeNulls?.includes(field)
      ) {
        continue;
      }
      fields[field] = {
        fetchedAt: fetchedAt.toISOString(),
        authority:
          value === null
            ? record.authoritativeNulls?.includes(field)
              ? 'explicit_null'
              : 'unknown'
            : 'value',
      };
    }
    const evidence = {
      dataset,
      fingerprint: valueFingerprint,
      fieldEvidence: {
        fields,
        returned: Object.keys(record.values),
        authoritativeNulls: [...(record.authoritativeNulls ?? [])],
      },
      publicationDate: record.publicationDate ?? null,
      availableDate:
        typeof after.availableDate === 'string'
          ? after.availableDate
          : (record.availableDate ?? null),
      availabilityQuality:
        typeof after.availabilityQuality === 'string'
          ? after.availabilityQuality
          : (record.availabilityQuality ?? 'unknown'),
      firstObservedAt:
        record.firstObservedAt ??
        (after.observedAt instanceof Date
          ? after.observedAt
          : previousEvidence?.fingerprint === valueFingerprint
            ? previousEvidence.firstObservedAt
            : fetchedAt),
      lastFetchedAt: fetchedAt,
    };
    await transaction.marketRecordEvidence.upsert({
      where: { tableName_businessKey: { tableName: batch.table, businessKey: key } },
      create: { tableName: batch.table, businessKey: key, ...evidence },
      update: evidence,
    });
  }
  for (let offset = 0; offset < inserts.length; offset += 200) {
    await delegate.createMany({ data: inserts.slice(offset, offset + 200) });
  }
  return acceptedKeys;
}

async function deleteAuthorizedExtent(
  transaction: MarketTransaction,
  batch: PreparedTable,
  partition: PreparedMarketPartition,
  existing: MarketRow[],
  acceptedKeys: Set<string>,
  result: AcceptedMarketPartition,
  validBatch: boolean,
): Promise<void> {
  const delegate = store(transaction, batch.table);

  // 未核验的批次不得删除；各原子完整对象的权限独立。
  // Deletion requires qualified authority; each complete atomic object keeps independent permission.
  if (
    batch.replacement?.basis &&
    ((batch.atomic && batch.replacement.independent && validBatch) ||
      (partition.status === 'complete' && !partition.errors.length && !result.rejected))
  ) {
    for (const before of existing) {
      const key = rowKey(batch.table, before);
      if (acceptedKeys.has(key)) {
        continue;
      }
      await delegate.deleteMany({ where: keyWhere(batch.table, before) });
      await transaction.marketRecordEvidence.deleteMany({
        where: { tableName: batch.table, businessKey: key },
      });
      result.deleted++;
      result.changes.push({ table: batch.table, before, after: null });
    }
  }
}

/**
 * 领域身份整理仅能读取同一市场白名单。
 *
 * Domain identity reconciliation can read only the same market allowlist.
 */
export async function readMarketRows(
  transaction: MarketTransaction,
  table: string,
  where: Record<string, unknown>,
): Promise<MarketRow[]> {
  return store(transaction, table).findMany({ where });
}
