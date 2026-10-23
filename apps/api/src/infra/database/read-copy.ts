import { DatabaseSync } from 'node:sqlite';
import { mkdir, lstat, realpath, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { acquireWorkOwner, MarketAccessBusyError } from '#infra/coordination/market-access.js';
import { pathToFileURL } from 'node:url';

export interface ReadCopyTable {
  name: string;
  dateColumn?: string;
  startDate?: string;
  endDate?: string;
  equals?: { column: string; value: string };
}

/**
 * 调用者持有稳定读作用域；仅复制声明表到私有计算文件，不复制用户数据。
 *
 * Callers hold a stable read scope; copy only declared tables into a private calculation file,
 * never user data.
 */
export async function createReadCopy(
  sourceFile: string,
  tables: ReadCopyTable[],
): Promise<{ filename: string; close(): Promise<void> }> {
  const resource = await createOwnedReadCopy(sourceFile);
  const filename = resource.filename;
  let database: DatabaseSync | undefined;
  const quote = (identifier: string) => {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(identifier)) {
      throw new Error('Invalid declared snapshot identifier');
    }
    return `"${identifier}"`;
  };
  try {
    database = new DatabaseSync(filename);
    const source = pathToFileURL(sourceFile);
    source.searchParams.set('mode', 'ro');
    database.prepare('ATTACH DATABASE ? AS inputs').run(source.href);
    database.exec('BEGIN');
    const created = new Set<string>();
    for (const table of tables) {
      const definition = database
        .prepare("SELECT sql FROM inputs.sqlite_master WHERE type='table' AND name=?")
        .get(table.name);
      if (typeof definition?.sql !== 'string') {
        throw new Error(`Missing calculation input table ${table.name}`);
      }
      if (!created.has(table.name)) {
        database.exec(definition.sql);
        created.add(table.name);
      }
      const conditions: string[] = [];
      const parameters: string[] = [];
      if (table.dateColumn && table.startDate && table.endDate) {
        conditions.push(`${quote(table.dateColumn)} BETWEEN ? AND ?`);
        parameters.push(table.startDate, table.endDate);
      }
      if (table.equals) {
        conditions.push(`${quote(table.equals.column)} = ?`);
        parameters.push(table.equals.value);
      }
      database
        .prepare(
          `INSERT INTO ${quote(table.name)} SELECT * FROM inputs.${quote(table.name)}${conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''}`,
        )
        .run(...parameters);
    }
    database.exec('COMMIT; DETACH DATABASE inputs');
  } catch (error) {
    try {
      database?.close();
    } finally {
      await resource.close();
    }
    throw error;
  }
  database.close();

  return resource;
}

const readCopyManifest = z.object({
  protocol: z.literal(1),
  kind: z.literal('market-calculation'),
  id: z.uuid(),
  source: z.string(),
  sourceDevice: z.number(),
  sourceInode: z.number(),
  directoryDevice: z.number(),
  directoryInode: z.number(),
  createdAt: z.iso.datetime(),
});

/**
 * 先取得 owner，再写入含数据库和目录身份的凭据；计算全程保留 owner。
 *
 * Acquire ownership before recording database and directory identities, retaining it through
 * compute.
 */
async function createOwnedReadCopy(sourceFile: string) {
  const source = await realpath(sourceFile);
  const formal = await lstat(source);
  const root = join(dirname(source), 'market-calculations');
  await mkdir(root, { recursive: true, mode: 0o700 });
  if ((await realpath(root)) !== root || !(await lstat(root)).isDirectory()) {
    throw new Error('Unverified calculation resource root');
  }

  const id = randomUUID();
  const owner = await acquireWorkOwner('market-calculation', `${source}:${id}`);
  const directory = join(root, id);
  let created = false;
  try {
    await mkdir(directory, { mode: 0o700 });
    created = true;
    const identity = await lstat(directory);
    await writeFile(
      join(directory, 'manifest.json'),
      JSON.stringify({
        protocol: 1,
        kind: 'market-calculation',
        id,
        source,
        sourceDevice: formal.dev,
        sourceInode: formal.ino,
        directoryDevice: identity.dev,
        directoryInode: identity.ino,
        createdAt: new Date().toISOString(),
      }),
      { flag: 'wx', mode: 0o600 },
    );
  } catch (error) {
    try {
      if (created) {
        await rm(directory, { recursive: true });
      }
    } finally {
      await owner.release();
    }
    throw error;
  }

  let closed = false;
  return {
    filename: join(directory, 'calculation.db'),
    async close() {
      if (closed) {
        return;
      }
      try {
        await rm(directory, { recursive: true });
      } finally {
        closed = true;
        await owner.release();
      }
    },
  };
}

/**
 * 只回收来源库、目录 inode、凭据和文件清单均匹配且失去 owner 的副本。
 *
 * Reclaim ownerless copies only when source identity, directory inode, manifest and files all
 * match.
 */
export async function cleanReadCopies(sourceFile: string): Promise<string[]> {
  const source = await realpath(sourceFile);
  const formal = await lstat(source);
  const root = join(dirname(source), 'market-calculations');
  const info = await lstat(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    return null;
  });
  if (!info) {
    return [];
  }
  if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(root)) !== root) {
    throw new Error('Unverified calculation resource root');
  }

  const retained: string[] = [];
  const known = new Set([
    'manifest.json',
    'calculation.db',
    'calculation.db-wal',
    'calculation.db-shm',
    'calculation.db-journal',
  ]);
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const directory = join(root, entry.name);
    if (!entry.isDirectory() || entry.isSymbolicLink() || !z.uuid().safeParse(entry.name).success) {
      retained.push(`Retained unknown calculation resource: ${entry.name}`);
      continue;
    }
    let owner;
    try {
      owner = await acquireWorkOwner('market-calculation', `${source}:${entry.name}`);
      const identity = await lstat(directory);
      const manifest = readCopyManifest.parse(
        JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')),
      );
      const files = await readdir(directory, { withFileTypes: true });
      if (
        manifest.id !== entry.name ||
        manifest.source !== source ||
        manifest.sourceDevice !== formal.dev ||
        manifest.sourceInode !== formal.ino ||
        manifest.directoryDevice !== identity.dev ||
        manifest.directoryInode !== identity.ino ||
        identity.isSymbolicLink() ||
        (await realpath(directory)) !== directory ||
        files.some((file) => !file.isFile() || file.isSymbolicLink() || !known.has(file.name))
      ) {
        retained.push(`Retained unverified calculation resource: ${entry.name}`);
        continue;
      }
      for (const file of files) {
        const contents = await lstat(join(directory, file.name));
        if (contents.dev === formal.dev && contents.ino === formal.ino) {
          throw new Error('Calculation resource aliases the source database');
        }
      }
      const current = await lstat(directory);
      if (current.dev !== identity.dev || current.ino !== identity.ino || !current.isDirectory()) {
        throw new Error('Calculation resource identity changed');
      }
      await rm(directory, { recursive: true });
    } catch (error) {
      retained.push(
        `${error instanceof MarketAccessBusyError ? 'Retained active' : 'Retained unreadable'} calculation resource: ${entry.name}`,
      );
    } finally {
      await owner?.release();
    }
  }

  return retained;
}
