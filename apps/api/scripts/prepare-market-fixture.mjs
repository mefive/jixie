// 从 SQLite 一致快照创建独立的市场压力测试库，默认只展示输入和输出。
// Prepare an isolated market load fixture from a SQLite snapshot; preview by default.
import { DatabaseSync } from 'node:sqlite';
import { chmod, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { resolve, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [sourceArgument, outputArgument, flag, ...extra] = process.argv.slice(2);
if (
  !sourceArgument ||
  !outputArgument ||
  !isAbsolute(sourceArgument) ||
  !isAbsolute(outputArgument) ||
  (flag !== undefined && flag !== '--apply') ||
  extra.length
) {
  throw new Error(
    'Usage: node prepare-market-fixture.mjs /absolute/snapshot.db /absolute/new-directory [--apply]',
  );
}
const source = await realpath(sourceArgument);
if (!(await stat(source)).isFile()) {
  throw new Error('Expected a SQLite snapshot');
}
const destination = resolve(outputArgument);
const filename = join(destination, 'market.db');
if (!flag) {
  console.log(JSON.stringify({ mode: 'preview', source, filename }, null, 2));
} else {
  // 只在新目录内建库。失败保留现场，下次须提供新路径。
  // Create only in a fresh directory; preserve failed output for inspection.
  await mkdir(destination, { mode: 0o700 });
  const schema = await readFile(
    new URL(
      '../prisma/market/migrations/20261116000000_market_baseline/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  const database = new DatabaseSync(filename);
  try {
    const uri = pathToFileURL(source);
    uri.searchParams.set('mode', 'ro');
    database.prepare('ATTACH DATABASE ? AS snapshot').run(uri.href);
    database.exec('PRAGMA foreign_keys=ON; BEGIN; PRAGMA defer_foreign_keys=ON');
    database.exec(schema);

    const tables = database
      .prepare(
        "SELECT name FROM main.sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all();
    const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
    const counts = {};
    for (const { name } of tables) {
      const columns = database
        .prepare('SELECT name FROM pragma_table_info(?, ?)')
        .all(name, 'main')
        .map((column) => quote(column.name))
        .join(', ');
      const table = quote(name);
      database.exec(
        `INSERT INTO main.${table} (${columns}) SELECT ${columns} FROM snapshot.${table}`,
      );
      const inserted = database.prepare('SELECT changes() AS n').get().n;
      const expected = database.prepare(`SELECT count(*) AS n FROM snapshot.${table}`).get().n;
      if (inserted !== expected) {
        throw new Error('Incomplete copy: ' + name);
      }
      counts[name] = inserted;
    }

    if (database.prepare('PRAGMA main.foreign_key_check').get()) {
      throw new Error('Invalid foreign key');
    }
    database.exec('COMMIT; DETACH DATABASE snapshot');
    if (database.prepare('PRAGMA main.quick_check').get().quick_check !== 'ok') {
      throw new Error('Invalid database');
    }
    console.log(JSON.stringify({ mode: 'fixture', source, filename, counts }, null, 2));
  } finally {
    database.close();
    await chmod(filename, 0o600);
  }
}
