import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, realpath, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { DataRequest } from './data.js';

const execute = promisify(execFile);

/**
 * 清理仅连接选定的已有库，不加载供应商配置；复用独立备份工具。
 *
 * Cleanup opens only the selected existing database, without provider configuration,
 * and reuses backup.
 */
export async function executeCleanupCommand(request: Extract<DataRequest, { action: 'clean' }>) {
  const { databaseFilename, MarketAccessBusyError } =
    await import('#infra/coordination/market-access.js');
  const filename = await realpath(request.database ?? databaseFilename());
  if (!(await stat(filename)).isFile()) {
    throw new Error('Cleanup requires an existing database file');
  }
  process.env.DATABASE_URL = `file:${filename}`;
  const { createDatabase, withDatabase, closeDatabase } = await import('#infra/database/prisma.js');
  const { cleanData } = await import('../clean.js');
  const database = createDatabase(`file:${filename}`);
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error('Cleanup interrupted'));
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);

  try {
    const result = await withDatabase(database, () =>
      cleanData({
        ...request,
        signal: controller.signal,
        backup: () => backupCleanupDatabase(filename, controller.signal),
      }),
    );
    console.log(JSON.stringify({ database: filename, ...result }, null, 2));

    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));

    return error instanceof MarketAccessBusyError ? 75 : 1;
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
    await closeDatabase(database);
  }
}

/**
 * 每次清理创建独立备份目录，不覆盖或轮换其他清理的恢复点。
 *
 * Give each cleanup its own backup directory without replacing or rotating other recovery points.
 */
async function backupCleanupDatabase(filename: string, signal: AbortSignal): Promise<string> {
  const root = process.env.JIXIE_BACKUP_DIR ?? join(homedir(), 'jixie-backups');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'data-clean-'));
  const apiDirectory = new URL(
    import.meta.url.includes('/dist/') ? '../../../../' : '../../../',
    import.meta.url,
  );
  await execute(process.execPath, [fileURLToPath(new URL('scripts/backup-db.mjs', apiDirectory))], {
    env: { ...process.env, JIXIE_DB_PATH: filename, JIXIE_BACKUP_DIR: directory },
    signal,
  });
  const files = (await readdir(directory)).filter((file) => file.endsWith('.db'));
  if (files.length !== 1) {
    throw new Error('Cleanup backup did not produce exactly one verified database');
  }

  return join(directory, files[0]);
}
