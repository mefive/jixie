import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  closeDatabase,
  createDatabase,
  withDatabase,
  type Prisma,
} from '#infra/database/prisma.js';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);

/**
 * 仅供审阅后测试：真实 schema 写入独立临时 SQLite，绝不连接工作库。
 *
 * Post-review tests only: materialize the real schema in isolated temporary SQLite, never the
 * working database.
 */
export async function withSyncDatabase<Result>(
  operation: (database: Prisma, directory: string) => Promise<Result>,
): Promise<Result> {
  const directory = await mkdtemp(join(tmpdir(), 'jixie-unified-sync-test-'));
  const url = `file:${join(directory, 'test.db')}`;
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = url;
  let database: Prisma | undefined;
  try {
    const schema = join(directory, 'schema.prisma');
    await writeFile(schema, await readFile(new URL('../prisma/schema.prisma', import.meta.url)));
    const empty = new DatabaseSync(join(directory, 'test.db'));
    empty.exec('PRAGMA user_version = 0');
    empty.close();

    await execute(
      process.execPath,
      [
        require.resolve('prisma/build/index.js'),
        'db',
        'push',
        '--skip-generate',
        '--schema',
        schema,
      ],
      { cwd: directory, env: { ...process.env, DATABASE_URL: url }, timeout: 30_000 },
    );
    database = createDatabase(url);

    return await withDatabase(database, () => operation(database!, directory));
  } finally {
    try {
      if (database) {
        await closeDatabase(database);
      }
    } finally {
      if (previous === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previous;
      }
      await rm(directory, { recursive: true, force: true });
    }
  }
}
