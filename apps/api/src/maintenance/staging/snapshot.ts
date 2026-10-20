import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { chmod, mkdir, open, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { MarketTable } from './tables.js';

export type StoredRow = Record<string, string | number | null>;
export interface StagingSnapshot {
  schemaHash: string;
  baseRevision: number;
  tables: string[];
}

export function quoted(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error('Invalid administrative SQL identifier');
  }

  return `"${name}"`;
}

export function schemaHash(database: DatabaseSync): string {
  const rows = database
    .prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )
    .all();

  const hasMigrations = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_prisma_migrations'")
    .get();
  const migrations = hasMigrations
    ? database
        .prepare(
          'SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name',
        )
        .all()
    : [];

  return createHash('sha256').update(JSON.stringify({ rows, migrations })).digest('hex');
}

/**
 * 使用同一个只读快照复制声明的市场表，DDL 直接复用正式迁移后的结构。
 *
 * Copy only declared market tables in one read snapshot, reusing the migrated schema verbatim.
 */
export async function createStagingSnapshot(
  sourceFile: string,
  directory: string,
  tables: readonly MarketTable[],
): Promise<StagingSnapshot> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const source = new DatabaseSync(sourceFile, { readOnly: true });
  const destinationFile = resolve(directory, 'candidate.db');
  const destination = new DatabaseSync(destinationFile);
  try {
    source.exec('BEGIN');
    const schema = source
      .prepare(
        "SELECT type, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name",
      )
      .all() as unknown as { type: string; sql: string }[];
    for (const row of schema) {
      destination.exec(row.sql);
    }
    const base = source
      .prepare('SELECT dataRevision FROM MaintenanceState WHERE key = ?')
      .get('global') as { dataRevision: number } | undefined;
    const snapshot: StagingSnapshot = {
      schemaHash: schemaHash(source),
      baseRevision: base?.dataRevision ?? 0,
      tables: tables.map((entry) => entry.name),
    };
    destination.exec('BEGIN');
    for (const name of [...snapshot.tables, 'MaintenanceState', '_prisma_migrations']) {
      const columns = source.prepare(`PRAGMA table_info(${quoted(name)})`).all() as unknown as {
        name: string;
      }[];
      if (!columns.length) {
        if (name === '_prisma_migrations') {
          continue;
        }
        throw new Error(`Missing staging dependency: ${name}`);
      }
      const insert = destination.prepare(
        `INSERT INTO ${quoted(name)} (${columns.map((column) => quoted(column.name)).join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
      );
      // 一致性复制属于数据库快照操作，不改变业务字段映射或公开 SDK。
      // Snapshot copying preserves storage values without deriving public SDK contracts.
      for (const row of source.prepare(`SELECT * FROM ${quoted(name)}`).iterate()) {
        insert.run(...columns.map((column) => row[column.name] as SQLInputValue));
      }
    }
    destination.exec('COMMIT');
    source.exec('COMMIT');
    await chmod(destinationFile, 0o600);
    await saveJson(resolve(directory, 'snapshot.json'), snapshot);

    return snapshot;
  } finally {
    destination.close();
    source.close();
  }
}

export async function saveJson(filename: string, value: unknown): Promise<void> {
  const temporary = `${filename}.tmp`;
  const file = await open(temporary, 'w', 0o600);
  try {
    await file.writeFile(JSON.stringify(value));
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, filename);
  const directory = await open(dirname(filename), 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
