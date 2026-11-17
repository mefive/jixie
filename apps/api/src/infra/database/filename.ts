import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';

/**
 * 按源代码或编译布局解析 Prisma 相对路径，正式身份不随暂存库改变。
 *
 * Resolve Prisma-relative database paths in source and compiled layouts.
 */
export function databaseFilename(url = process.env.DATABASE_URL): string {
  if (!url?.startsWith('file:')) {
    throw new Error('Market coordination requires an explicit SQLite DATABASE_URL');
  }
  const schemaDirectory = fileURLToPath(
    new URL(
      import.meta.url.includes('/dist/') ? '../../../../prisma/' : '../../../prisma/',
      import.meta.url,
    ),
  );

  const filename = resolve(schemaDirectory, url.slice(5).split('?')[0]);
  try {
    return realpathSync(filename);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    return filename;
  }
}

export function marketVersionFile(id: string): string {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) {
    throw new Error('Invalid market version ID');
  }

  return join(dirname(databaseFilename()), 'market', 'versions', id, 'market.db');
}
