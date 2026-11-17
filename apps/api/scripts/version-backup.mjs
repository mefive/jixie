// 备份清单与应用快照、各版本文件一起交付。仅依赖 Node 和 sqlite3。
// Ship the application snapshot and all referenced files in one backup directory.
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

function query(file, sql) {
  return JSON.parse(
    execFileSync('sqlite3', ['-readonly', '-json', file, sql], { encoding: 'utf8' }).trim() || '[]',
  );
}
function copy(source, dest) {
  execFileSync('sqlite3', [
    '-readonly',
    source,
    '.timeout 10000',
    '.backup "' + dest.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"',
  ]);
  if (!query(dest, "SELECT name FROM sqlite_schema WHERE type='table' LIMIT 1").length) {
    throw new Error('Empty backup');
  }
}
const controlSQL =
  'SELECT id,operation,phase,activeSlot,readyAt,publishedAt,finishedAt,candidateVersion,historyVersionId FROM MarketVersion WHERE historyVersionId IS NULL AND (publishedAt IS NOT NULL OR activeSlot=1) ORDER BY id';

export function backupMarketStorage(source, root, keep, prefix, stamp) {
  const staging = mkdtempSync(join(root, '.market-backup-'));
  try {
    const app = join(staging, basename(source));
    copy(source, app);
    const controls = query(app, controlSQL);
    const pointer = query(app, "SELECT * FROM MarketPublication WHERE key='global'")[0];
    if (!pointer?.currentVersionId) {
      throw new Error('Missing active publication');
    }

    const versions = [];
    for (const row of controls) {
      if (!row.readyAt && !row.publishedAt) {
        continue;
      }
      if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(row.id)) {
        throw new Error('Invalid version ID');
      }
      const relative = join('market', 'versions', row.id, 'market.db');
      const target = join(staging, relative);
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      copy(join(dirname(source), relative), target);
      if (row.publishedAt) {
        execFileSync('sqlite3', [target, 'PRAGMA journal_mode=DELETE']);
        chmodSync(target, 0o400);
      }
      versions.push(relative);
    }
    if (
      JSON.stringify(query(source, controlSQL)) !== JSON.stringify(controls) ||
      JSON.stringify(query(source, "SELECT * FROM MarketPublication WHERE key='global'")[0]) !==
        JSON.stringify(pointer)
    ) {
      throw new Error('Market publication changed during backup; retry');
    }
    writeFileSync(
      join(staging, 'manifest.json'),
      JSON.stringify({ application: basename(source), pointer, versions }, null, 2),
      { flag: 'wx', mode: 0o600 },
    );
    const name = prefix + '-' + stamp + '.bundle';
    if (existsSync(join(root, name))) {
      throw new Error('Backup name already exists');
    }
    renameSync(staging, join(root, name));
    for (const stale of readdirSync(root, { withFileTypes: true })
      .filter(
        (item) =>
          item.isDirectory() &&
          item.name.startsWith(prefix + '-') &&
          /-\d{8}-\d{6}\.bundle$/.test(item.name),
      )
      .map((item) => item.name)
      .sort()
      .reverse()
      .slice(keep)) {
      rmSync(join(root, stale), { recursive: true });
    }
    console.log('[backup] ' + join(root, name));
  } finally {
    if (existsSync(staging)) {
      rmSync(staging, { recursive: true });
    }
  }
}
