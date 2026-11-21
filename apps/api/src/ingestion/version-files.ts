import {
  ANY_WRITE_BIT,
  OWNER_READ_ONLY,
  OWNER_READ_WRITE,
  OWNER_ONLY_DIRECTORY,
} from '#infra/file-permissions.js';
import { constants } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { marketVersionFile } from '#infra/database/filename.js';
export { marketVersionFile } from '#infra/database/filename.js';

const execute = promisify(execFile);

async function syncPath(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await file.sync();
  } finally {
    await file.close();
  }
}

/**
 * 发布前封存，核对 checkpoint、日志模式和外键，始终在短指针事务外执行。
 *
 * Seal and validate the checkpoint, journal mode and foreign keys before the pointer transaction.
 */
export async function sealMarketFile(id: string) {
  const filename = marketVersionFile(id);
  const info = await lstat(filename);
  if (!info.isFile()) {
    throw new Error('Expected a regular market database file');
  }

  if ((info.mode & ANY_WRITE_BIT) !== 0) {
    const { stdout } = await execute('sqlite3', [
      '-batch',
      '-bail',
      filename,
      'PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;',
    ]);
    const [checkpoint, mode] = stdout.trim().split('\n');
    if (!/^0\|(0\|0|-1\|-1)$/.test(checkpoint) || mode !== 'delete') {
      throw new Error('Market checkpoint did not complete');
    }
    await chmod(filename, OWNER_READ_ONLY);
  }

  const { stdout } = await execute('sqlite3', [
    '-readonly',
    '-batch',
    '-bail',
    filename,
    'PRAGMA journal_mode; PRAGMA foreign_key_check;',
  ]);
  if (stdout.trim() !== 'delete') {
    throw new Error('Market file failed sealing checks');
  }
  await syncPath(filename);
  await syncPath(dirname(filename));
  await syncPath(dirname(dirname(filename)));
}

/**
 * 父版只读，目标目录须是新建目录；中断遗留文件不会被误作成功克隆。
 *
 * Clone a sealed parent into a new directory without treating interrupted staging as a valid clone.
 */
export async function cloneMarketFile(parentId: string, id: string) {
  const source = marketVersionFile(parentId);
  const target = marketVersionFile(id);
  const directory = dirname(target);
  const info = await lstat(source);
  if (!info.isFile() || (info.mode & ANY_WRITE_BIT) !== 0) {
    throw new Error('Market parent must already be sealed');
  }
  await mkdir(directory, { mode: OWNER_ONLY_DIRECTORY });
  const staging = join(directory, 'market.creating');
  let method: 'reflink' | 'backup' = 'reflink';

  try {
    try {
      await copyFile(source, staging, constants.COPYFILE_FICLONE_FORCE | constants.COPYFILE_EXCL);
    } catch (error) {
      if (
        !['ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV', 'EINVAL'].includes(
          (error as NodeJS.ErrnoException).code ?? '',
        )
      ) {
        throw error;
      }
      method = 'backup';
      await execute('sqlite3', ['-readonly', '-bail', source, '.backup market.creating'], {
        cwd: directory,
      });
    }
    await chmod(staging, OWNER_READ_WRITE);
    await syncPath(staging);
    await rename(staging, target);
    await syncPath(directory);
    await syncPath(dirname(directory));
  } catch (error) {
    await unlink(staging).catch((failure: NodeJS.ErrnoException) => {
      if (failure.code !== 'ENOENT') {
        throw failure;
      }
    });
    throw error;
  }

  return { method, bytes: info.size };
}

/**
 * 空基线使用同一市场 schema 创建。
 *
 * Initialize a pristine market file using its own migrations.
 */
export async function createEmptyMarketFile(id: string) {
  const filename = marketVersionFile(id);
  const directory = dirname(filename);
  await mkdir(dirname(directory), { recursive: true, mode: OWNER_ONLY_DIRECTORY });
  await mkdir(directory, { mode: OWNER_ONLY_DIRECTORY });
  const empty = await open(filename, 'wx', OWNER_READ_WRITE);
  await empty.close();

  const api = new URL(import.meta.url.includes('/dist/') ? '../../../' : '../../', import.meta.url);
  const { createRequire } = await import('node:module');
  const { fileURLToPath } = await import('node:url');
  const require = createRequire(import.meta.url);
  const schema = fileURLToPath(new URL('prisma/market/schema.prisma', api));
  await execute(
    process.execPath,
    [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', schema],
    { env: { ...process.env, MARKET_DATABASE_URL: 'file:' + filename } },
  );
}

export async function discardMarketFile(id: string) {
  const path = marketVersionFile(id);
  for (const name of [
    path,
    path + '-shm',
    path + '-wal',
    path + '-journal',
    join(dirname(path), 'market.creating'),
  ]) {
    await unlink(name).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    });
  }
  const { rmdir } = await import('node:fs/promises');
  await rmdir(dirname(path)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  });
}
