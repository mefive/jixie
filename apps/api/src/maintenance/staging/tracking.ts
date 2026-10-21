import type { DatabaseSync } from 'node:sqlite';
import type { MarketTable } from './tables.js';

export function quoted(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error('Invalid administrative SQL identifier');
  }

  return `"${name}"`;
}

export const TRACKED_KEYS = '_maintenance_touched_keys';

/**
 * 候选私有记录只存触及的业务键；初始复制不记录，事务回滚同时撤销记录。
 *
 * Candidate-private tracking stores touched business keys only, after copying and within each write transaction.
 */
function trackingDefinitions(tables: readonly MarketTable[]): Map<string, string> {
  const definitions = new Map<string, string>([
    [
      TRACKED_KEYS,
      `CREATE TABLE ${quoted(TRACKED_KEYS)} (tableName TEXT NOT NULL, rowKey TEXT NOT NULL, PRIMARY KEY (tableName, rowKey)) WITHOUT ROWID`,
    ],
  ]);
  for (const operation of ['UPDATE', 'DELETE'] as const) {
    const name = `_maintenance_protect_keys_${operation}`;
    definitions.set(
      name,
      `CREATE TRIGGER ${quoted(name)} BEFORE ${operation} ON ${quoted(TRACKED_KEYS)} BEGIN SELECT RAISE(ABORT, 'Candidate tracking keys cannot be removed or rewritten'); END`,
    );
  }
  for (const table of tables) {
    const record = (reference: 'OLD' | 'NEW') => {
      const key = `json_array(${table.keys.map((column) => `${reference}.${quoted(column)}`).join(',')})`;

      // 显式排除已有键，避免外层 INSERT 的冲突策略覆盖触发器内的去重策略。
      // Exclude existing keys explicitly so the outer INSERT conflict policy cannot override deduplication.
      return `INSERT INTO ${quoted(TRACKED_KEYS)} (tableName, rowKey) SELECT '${table.name}', ${key} WHERE NOT EXISTS (SELECT 1 FROM ${quoted(TRACKED_KEYS)} WHERE tableName='${table.name}' AND rowKey=${key});`;
    };
    for (const operation of ['INSERT', 'UPDATE', 'DELETE'] as const) {
      const name = `_maintenance_track_${table.name}_${operation}`;
      const statements =
        operation === 'UPDATE'
          ? `${record('OLD')} ${record('NEW')}`
          : record(operation === 'DELETE' ? 'OLD' : 'NEW');
      definitions.set(
        name,
        `CREATE TRIGGER ${quoted(name)} AFTER ${operation} ON ${quoted(table.name)} BEGIN ${statements} END`,
      );
    }
  }

  return definitions;
}

export function installTracking(database: DatabaseSync, tables: readonly MarketTable[]): void {
  for (const sql of trackingDefinitions(tables).values()) {
    database.exec(sql);
  }
}

/**
 * 只在逐项确认候选设施定义完整且未变更后，从业务结构指纹中排除这些确切对象。
 *
 * Exclude exact private objects from the business schema hash only after validating every definition.
 */
export function validateTracking(
  database: DatabaseSync,
  tables: readonly MarketTable[],
): Set<string> {
  const definitions = trackingDefinitions(tables);
  const lookup = database.prepare('SELECT sql FROM sqlite_master WHERE name=?');
  for (const [name, sql] of definitions) {
    if (lookup.get(name)?.sql !== sql) {
      throw new Error(`Candidate change tracking is missing or altered: ${name}`);
    }
  }

  return new Set(definitions.keys());
}
