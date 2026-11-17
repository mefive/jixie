import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { withDatabase, createDatabase, closeDatabase } from '#infra/database/prisma.js';

/**
 * 使用正式初始化入口在临时目录创建两库。
 *
 * Exercise real initialization with both databases in a temporary directory.
 */
export async function withVersionedStorage<Result>(work: () => Promise<Result>) {
  const dir = await mkdtemp(join(tmpdir(), 'jixie-versioned-'));
  const file = join(dir, 'app.db');
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'file:' + file;
  const owner = createDatabase(process.env.DATABASE_URL);
  try {
    await promisify(execFile)(process.execPath, [
      fileURLToPath(new URL('../scripts/initialize-market-storage.mjs', import.meta.url)),
      file,
    ]);
    return await withDatabase(owner, work);
  } finally {
    await closeDatabase(owner);
    if (previous === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previous;
    }
    await rm(dir, { recursive: true, force: true });
  }
}
