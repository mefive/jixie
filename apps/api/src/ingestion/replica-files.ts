import { execFile } from 'node:child_process';
import { chmod, lstat, mkdir, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import {
  closeDatabase,
  createDatabase,
  withDatabase,
  type Prisma,
} from '#infra/database/prisma.js';
import { databaseFilename } from '#infra/coordination/market-access.js';

export function candidateFilename(runId: string): string {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(runId)) {
    throw new Error('Invalid candidate run ID');
  }

  return join(dirname(databaseFilename()), 'ingestion-candidates', runId, 'candidate.db');
}

async function privateDirectory(path: string) {
  await mkdir(path, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  });
  const info = await lstat(path);
  if (!info.isDirectory() || (info.mode & 0o077) !== 0) {
    throw new Error('Candidate directory must be private and cannot be a symbolic link');
  }
}

export async function hasCandidateFile(path: string): Promise<boolean> {
  try {
    if (!(await lstat(path)).isFile()) {
      throw new Error('Candidate path must identify a regular file');
    }

    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/** 用 SQLite 在线备份创建可恢复的副本。 / Create a recoverable candidate with SQLite online backup. */
export async function createCandidateFile(path: string, signal?: AbortSignal) {
  await privateDirectory(dirname(dirname(path)));
  await privateDirectory(dirname(path));
  const staging = path + '.creating';
  await unlink(staging).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  });
  const destination = staging.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  await promisify(execFile)(
    'sqlite3',
    ['-readonly', databaseFilename(), '.timeout 5000', `.backup "${destination}"`],
    { signal },
  );
  await chmod(staging, 0o600);
  await rename(staging, path);
}

/** 副本缺失时拒绝连接，避免 SQLite 建空库。 / Reject absent candidates before SQLite can create an empty file. */
export async function withCandidate<Result>(
  runId: string,
  operation: (database: Prisma) => Promise<Result>,
) {
  const path = candidateFilename(runId);
  if (!(await hasCandidateFile(path))) {
    throw new Error('Candidate database is missing');
  }
  const database = createDatabase('file:' + path);
  try {
    return await withDatabase(database, () => operation(database));
  } finally {
    await closeDatabase(database);
  }
}

export async function cleanupCandidate(runId: string): Promise<boolean> {
  const path = candidateFilename(runId);
  try {
    for (const suffix of ['', '-wal', '-shm', '.creating']) {
      await unlink(path + suffix).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      });
    }

    return true;
  } catch {
    return false;
  }
}
