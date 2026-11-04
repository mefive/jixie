import { z } from 'zod';
import type { Prisma } from '@prisma/client';

const catalogRowSchema = z.object({ name: z.string(), sql: z.string().nullable() });
const columnSchema = z.object({
  cid: z.coerce.number(),
  name: z.string(),
  type: z.string(),
  notNull: z.coerce.number(),
  defaultValue: z.unknown(),
  primaryKeyOrder: z.coerce.number(),
});
const indexSchema = z.object({
  name: z.string(),
  isUnique: z.coerce.number(),
  origin: z.string(),
  partial: z.coerce.number(),
});
const indexColumnSchema = z.object({
  seqno: z.coerce.number(),
  cid: z.coerce.number(),
  name: z.string().nullable(),
});
const foreignKeySchema = z.object({
  id: z.coerce.number(),
  seq: z.coerce.number(),
  referencedTable: z.string(),
  fromColumn: z.string(),
  toColumn: z.string().nullable(),
  onUpdate: z.string(),
  onDelete: z.string(),
  match: z.string(),
});

/**
 * 只读 SQLite 系统元数据，表名来自内部白名单而非用户 SQL。
 *
 * Read SQLite catalog metadata only; callers supply internal tables, never user SQL.
 */
export async function readDiagnosticTableSchema(database: Prisma.TransactionClient, table: string) {
  const catalog = z.array(catalogRowSchema).parse(
    await database.$queryRaw`
    SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name = ${table}
  `,
  );
  const columns = z.array(columnSchema).parse(
    await database.$queryRaw`
    SELECT cid, name, type, "notnull" AS "notNull", dflt_value AS "defaultValue",
           pk AS "primaryKeyOrder" FROM pragma_table_info(${table}) ORDER BY cid
  `,
  );
  const indexes = z.array(indexSchema).parse(
    await database.$queryRaw`
    SELECT name, "unique" AS "isUnique", origin, partial
    FROM pragma_index_list(${table}) ORDER BY name
  `,
  );
  const indexDetails = [];
  for (const index of indexes) {
    const definition = z.array(catalogRowSchema).parse(
      await database.$queryRaw`
      SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name = ${index.name}
    `,
    );
    const indexColumns = z.array(indexColumnSchema).parse(
      await database.$queryRaw`
      SELECT seqno, cid, name FROM pragma_index_info(${index.name}) ORDER BY seqno
    `,
    );
    indexDetails.push({ ...index, sql: definition[0]?.sql ?? null, columns: indexColumns });
  }
  const foreignKeys = z.array(foreignKeySchema).parse(
    await database.$queryRaw`
    SELECT id, seq, "table" AS "referencedTable", "from" AS "fromColumn",
           "to" AS "toColumn", on_update AS "onUpdate", on_delete AS "onDelete", "match" AS "match"
    FROM pragma_foreign_key_list(${table}) ORDER BY id, seq
  `,
  );

  return {
    table,
    exists: catalog.length === 1,
    sql: catalog[0]?.sql ?? null,
    columns,
    indexes: indexDetails,
    foreignKeys,
  };
}

/**
 * Prisma 迁移记录是 schema 身份证据；db push 的隔离库可以没有该表。
 *
 * Prisma migration receipts identify the schema; isolated db-push databases may lack them.
 */
export async function readDiagnosticMigrations(database: Prisma.TransactionClient) {
  const catalog = z.array(catalogRowSchema).parse(
    await database.$queryRaw`
    SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name = '_prisma_migrations'
  `,
  );
  if (!catalog.length) {
    return { available: false, applied: [] };
  }
  const schema = z.array(z.object({ migrationName: z.string(), checksum: z.string() }));
  const applied = schema.parse(
    await database.$queryRaw`
    SELECT migration_name AS "migrationName", checksum FROM _prisma_migrations
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name
  `,
  );

  return { available: true, applied };
}
