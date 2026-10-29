import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { realpath, stat } from 'node:fs/promises';

/**
 * 离线升级入口只接受显式已有数据库，不读取应用默认库或访问外部来源。
 *
 * The offline upgrade accepts only an explicit existing database, without defaults or external sources.
 */
export async function runPendingEtfCleanup(args: string[]): Promise<number> {
  const [mode, filename] = args;
  if (
    args.length !== 2 ||
    !['check', 'apply'].includes(mode) ||
    !filename ||
    !isAbsolute(filename)
  ) {
    console.error('Usage: cleanup-pending-etfs check|apply /absolute/path/database.db');
    return 2;
  }

  const databaseFile = await realpath(filename);
  if (!(await stat(databaseFile)).isFile()) {
    throw new Error('Cleanup requires an existing database file');
  }
  process.env.DATABASE_URL = `file:${databaseFile}`;
  const { prisma, withDatabase, closeDatabase } = await import('#infra/database/prisma.js');
  try {
    const { cleanupPendingEtfs } = await import('../etfs/cleanup-pending.js');
    const result = await withDatabase(prisma, () => cleanupPendingEtfs(mode === 'apply'));
    for (const row of result.protectedRows) {
      console.error(`Retained pending ETF ${row.tsCode}: ${row.reasons.join(', ')}`);
    }
    console.log(mode === 'check' ? result.removableCodes.length : JSON.stringify(result));

    return 0;
  } finally {
    await closeDatabase(prisma);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = await runPendingEtfCleanup(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
