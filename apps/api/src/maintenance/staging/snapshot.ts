import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { installTracking, quoted, validateTracking } from './tracking.js';
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

export function schemaHash(
  database: DatabaseSync,
  trackingTables?: readonly MarketTable[],
  schema: 'main' | 'baseline' = 'main',
): string {
  const ignored = trackingTables ? validateTracking(database, trackingTables) : new Set<string>();
  const rows = database
    .prepare(
      `SELECT type, name, sql FROM ${schema}.sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type, name`,
    )
    .all()
    .filter((row) => !ignored.has(String(row.name)));

  const hasMigrations = database
    .prepare(
      `SELECT name FROM ${schema}.sqlite_master WHERE type='table' AND name='_prisma_migrations'`,
    )
    .get();
  const migrations = hasMigrations
    ? database
        .prepare(
          `SELECT migration_name, checksum, finished_at, rolled_back_at FROM ${schema}._prisma_migrations ORDER BY migration_name`,
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
  const destinationFile = resolve(directory, 'candidate.db');
  const destination = new DatabaseSync(destinationFile);
  try {
    await chmod(destinationFile, 0o600);
    const baselineUrl = pathToFileURL(sourceFile);
    baselineUrl.searchParams.set('mode', 'ro');
    destination.prepare('ATTACH DATABASE ? AS baseline').run(baselineUrl.href);
    destination.exec('PRAGMA foreign_keys=OFF; BEGIN');
    const schema = destination
      .prepare(
        "SELECT type, sql FROM baseline.sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name",
      )
      .all() as unknown as { type: string; sql: string }[];
    const base = destination
      .prepare('SELECT dataRevision FROM baseline.MaintenanceState WHERE key=?')
      .get('global');
    const snapshot: StagingSnapshot = {
      schemaHash: schemaHash(destination, undefined, 'baseline'),
      baseRevision: Number(base?.dataRevision ?? 0),
      tables: tables.map((entry) => entry.name),
    };
    for (const row of schema.filter((entry) => entry.type === 'table')) {
      destination.exec(row.sql);
    }

    // 同一连接、同一读快照在 SQLite 内复制；不把历史逐行送入 JavaScript。
    // Copy inside SQLite on one connection and one read snapshot, without streaming historical rows through JavaScript.
    for (const name of [...snapshot.tables, 'MaintenanceState', '_prisma_migrations']) {
      const columns = destination
        .prepare(`PRAGMA baseline.table_info(${quoted(name)})`)
        .all() as unknown as { name: string }[];
      if (!columns.length) {
        if (name === '_prisma_migrations') {
          continue;
        }
        throw new Error(`Missing staging dependency: ${name}`);
      }
      const columnList = columns.map((column) => quoted(column.name)).join(',');
      const started = performance.now();
      const result = destination
        .prepare(
          `INSERT INTO main.${quoted(name)} (${columnList}) SELECT ${columnList} FROM baseline.${quoted(name)}`,
        )
        .run();
      console.info(
        `[maintenance] snapshot ${name}: ${result.changes} rows, ${Math.round(performance.now() - started)} ms`,
      );
    }

    // 数据复制后建立索引和触发器，随后才启用本轮变更记录。
    // Build indexes and triggers after copying, then enable tracking for this run's writes only.
    console.info('[maintenance] snapshot indexes and schema objects started');
    for (const row of schema.filter((entry) => entry.type !== 'table')) {
      destination.exec(row.sql);
    }
    installTracking(destination, tables);
    if (schemaHash(destination, tables) !== snapshot.schemaHash) {
      throw new Error('Copied candidate schema does not match the formal baseline');
    }
    destination.exec('COMMIT; DETACH DATABASE baseline; PRAGMA foreign_keys=ON');
    await saveJson(resolve(directory, 'snapshot.json'), snapshot);

    return snapshot;
  } finally {
    destination.close();
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
