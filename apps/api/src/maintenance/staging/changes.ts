import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { closeSync, openSync, writeSync, fsyncSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import pkg from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { quoted, type StoredRow } from './snapshot.js';
import type { MarketTable } from './tables.js';

export interface MarketChange {
  operation: 'insert' | 'update' | 'delete';
  row: StoredRow;
  before?: StoredRow;
}
export interface TableChanges {
  table: string;
  count: number;
  hash: string;
}
const storedRowSchema = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));

export const marketChangeSchema = z
  .object({
    operation: z.enum(['insert', 'update', 'delete']),
    row: storedRowSchema,
    before: storedRowSchema.optional(),
  })
  .refine((change) => change.operation !== 'update' || change.before !== undefined, {
    message: 'Updated market changes require their baseline values',
  });

interface PublicationDelegate {
  createMany(input: { data: Record<string, unknown>[] }): Promise<unknown>;
  updateMany(input: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
  deleteMany(input: { where: Record<string, unknown> }): Promise<{ count: number }>;
}

function compareKeys(left: StoredRow, right: StoredRow, keys: readonly string[]): number {
  for (const key of keys) {
    const first = left[key];
    const second = right[key];
    const difference =
      typeof first === 'number' && typeof second === 'number'
        ? first - second
        : Buffer.compare(Buffer.from(String(first)), Buffer.from(String(second)));
    if (difference) {
      return difference;
    }
  }

  return 0;
}

/**
 * 在发布门禁前比较规范候选与只读正式基线，保留显式数据域的删除规则。
 *
 * Freeze domain changes before admission closes, preserving deletions and special version semantics.
 */
export function freezeTableChanges(
  source: DatabaseSync,
  candidate: DatabaseSync,
  directory: string,
  table: MarketTable,
): TableChanges {
  const order = table.keys.map(quoted).join(',');
  const query = `SELECT * FROM ${quoted(table.name)} ORDER BY ${order}`;
  const baseline = source.prepare(query).iterate() as IterableIterator<StoredRow>;
  const prepared = candidate.prepare(query).iterate() as IterableIterator<StoredRow>;
  let before = baseline.next();
  let after = prepared.next();
  const descriptor = openSync(resolve(directory, `${table.name}.changes`), 'w', 0o600);
  const digest = createHash('sha256');
  let count = 0;
  const append = (change: MarketChange) => {
    if (table.policy === 'immutable' && change.operation !== 'insert') {
      throw new Error(`Immutable market publication changed: ${table.name}`);
    }
    if (table.policy === 'versioned' && change.operation === 'delete') {
      throw new Error(`Financial source version was deleted: ${table.name}`);
    }
    const line = `${JSON.stringify(change)}\n`;
    digest.update(line);
    writeSync(descriptor, line);
    count++;
  };
  try {
    while (!before.done || !after.done) {
      const comparison = before.done
        ? 1
        : after.done
          ? -1
          : compareKeys(before.value, after.value, table.keys);
      if (comparison < 0) {
        append({ operation: 'delete', row: before.value! });
        before = baseline.next();
      } else if (comparison > 0) {
        append({ operation: 'insert', row: after.value! });
        after = prepared.next();
      } else {
        if (JSON.stringify(before.value) !== JSON.stringify(after.value)) {
          if (table.policy === 'versioned') {
            const allowed = new Set([
              'tsCode',
              'availabilityQuality',
              'evidenceSource',
              'evidenceId',
            ]);
            if (
              Object.keys(before.value!).some(
                (key) => !allowed.has(key) && before.value![key] !== after.value![key],
              )
            ) {
              throw new Error(`Financial source payload mutated: ${table.name}`);
            }
          }
          append({ operation: 'update', row: after.value!, before: before.value! });
        }
        before = baseline.next();
        after = prepared.next();
      }
    }
  } finally {
    baseline.return?.();
    prepared.return?.();
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  }

  return { table: table.name, count, hash: digest.digest('hex') };
}

/**
 * 将 SQLite 存储值还原为同一 Prisma schema 的内部入库类型，不派生公开 SDK。
 *
 * Decode administrative snapshot values for the existing internal Prisma schema only.
 */
function prismaRow(table: MarketTable, row: StoredRow): Record<string, unknown> {
  const model = pkg.Prisma.dmmf.datamodel.models.find((entry) => entry.name === table.name);
  if (!model) {
    throw new Error(`Unknown declared market model: ${table.name}`);
  }

  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      const type = model.fields.find((field) => field.name === key)?.type;
      if (value === null) {
        return [key, type === 'Json' ? pkg.Prisma.DbNull : null];
      }
      switch (type) {
        case 'DateTime':
          return [key, new Date(value)];
        case 'Boolean':
          return [key, Boolean(value)];
        case 'Json':
          return [key, JSON.parse(String(value))];
        default:
          return [key, value];
      }
    }),
  );
}

export async function applyTableChanges(
  transaction: Prisma.TransactionClient,
  directory: string,
  table: MarketTable,
  changes: TableChanges,
  mode: 'delete' | 'write' = 'write',
): Promise<void> {
  const filename = resolve(directory, `${table.name}.changes`);
  const digest = createHash('sha256');
  const delegate = (transaction as unknown as Record<string, PublicationDelegate>)[table.model];
  const lines = createInterface({ input: createReadStream(filename), crlfDelay: Infinity });
  let count = 0;
  let inserts: Record<string, unknown>[] = [];
  const flush = async () => {
    if (inserts.length) {
      await delegate.createMany({ data: inserts });
      inserts = [];
    }
  };
  try {
    for await (const line of lines) {
      digest.update(line + '\n');
      const change = marketChangeSchema.parse(JSON.parse(line));
      count++;
      if ((change.operation === 'delete') !== (mode === 'delete')) {
        continue;
      }
      const row = prismaRow(table, change.row);
      const where = Object.fromEntries(table.keys.map((key) => [key, row[key]]));
      switch (change.operation) {
        case 'insert':
          inserts.push(row);
          if (inserts.length >= 200) {
            await flush();
          }
          break;
        case 'update': {
          await flush();
          const result = await delegate.updateMany({ where, data: row });
          if (result.count !== 1) {
            throw new Error(`Market baseline update conflict: ${table.name}`);
          }
          break;
        }
        case 'delete': {
          const result = await delegate.deleteMany({ where });
          if (result.count !== 1) {
            throw new Error(`Market baseline deletion conflict: ${table.name}`);
          }
          break;
        }
        default:
          throw new Error('Invalid market change operation');
      }
    }
    await flush();
  } finally {
    lines.close();
  }
  if (digest.digest('hex') !== changes.hash) {
    throw new Error(`Frozen change manifest corrupted: ${table.name}`);
  }
  if (count !== changes.count) {
    throw new Error(`Frozen change count mismatch: ${table.name}`);
  }
}
