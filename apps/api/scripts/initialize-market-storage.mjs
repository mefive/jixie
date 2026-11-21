// 部署或本地初始化入口；已有混合库只能通过显式的隔离迁移转换。
// Initialize local or deployed versioned storage. Convert existing mixed databases offline.
import { OWNER_READ_ONLY, OWNER_READ_WRITE, OWNER_ONLY_DIRECTORY } from './file-permissions.mjs';
import { existsSync, openSync, closeSync } from 'node:fs';
import { mkdir, chmod, open } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { isAbsolute, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { ulid } from 'ulid';

const file = process.argv[2];
if (!isAbsolute(file ?? '') || process.argv.length !== 3) {
  throw new Error('Expected an absolute application database filename');
}
const root = dirname(file);
if (existsSync(join(root, 'ingestion-rebuild.required'))) {
  throw new Error('Resolve the legacy rebuild marker before initializing versioned storage');
}
if (existsSync(file)) {
  const existing = new DatabaseSync(file, { readOnly: true });
  try {
    const tables = new Set(
      existing
        .prepare("SELECT name FROM sqlite_schema WHERE type='table'")
        .all()
        .map((row) => row.name),
    );
    if (
      tables.has('Daily') ||
      tables.has('DataSyncRun') ||
      (tables.size && !tables.has('MarketPublication') && !tables.has('_prisma_migrations'))
    ) {
      throw new Error(
        'Mixed or unknown application database. Use the offline storage conversion first.',
      );
    }
  } finally {
    existing.close();
  }
}
const required = createRequire(import.meta.url);
const migrate = (kind, path) => {
  // 首次迁移前独占创建空文件；已有数据库继续使用原文件。
  // Reserve a missing SQLite file exclusively before invoking the migration engine.
  if (!existsSync(path)) {
    closeSync(openSync(path, 'wx', OWNER_READ_WRITE));
  }

  const schema = fileURLToPath(new URL('../prisma/' + kind + '/schema.prisma', import.meta.url));
  const envName = kind === 'app' ? 'DATABASE_URL' : 'MARKET_DATABASE_URL';
  execFileSync(
    process.execPath,
    [required.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', schema],
    {
      env: { ...process.env, [envName]: 'file:' + path },
      stdio: 'inherit',
    },
  );
};
await mkdir(root, { recursive: true, mode: OWNER_ONLY_DIRECTORY });
migrate('app', file);
const app = new DatabaseSync(file);
try {
  app.exec('BEGIN IMMEDIATE');
  const pointer = app
    .prepare("SELECT currentVersionId FROM MarketPublication WHERE key='global'")
    .get();
  if (pointer) {
    if (
      !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(pointer.currentVersionId) ||
      !existsSync(join(root, 'market', 'versions', pointer.currentVersionId, 'market.db'))
    ) {
      throw new Error('Published market file is unavailable; restore the versioned backup');
    }
  } else {
    if (app.prepare('SELECT count(*) AS n FROM MarketVersion').get().n) {
      throw new Error('Market version metadata exists without a publication pointer');
    }
    const id = ulid();
    const directory = join(root, 'market', 'versions', id);
    await mkdir(directory, { recursive: true, mode: OWNER_ONLY_DIRECTORY });
    const market = join(directory, 'market.db');
    migrate('market', market);
    const database = new DatabaseSync(market);
    try {
      database.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE');
    } finally {
      database.close();
    }
    await chmod(market, OWNER_READ_ONLY);
    for (const entry of [
      market,
      directory,
      dirname(directory),
      dirname(dirname(directory)),
      root,
    ]) {
      const fd = await open(entry, 'r');
      try {
        await fd.sync();
      } finally {
        await fd.close();
      }
    }
    app
      .prepare(
        "INSERT INTO MarketVersion(id,runId,targetDate,phase,parentSequence,selectionVersion,publishedAt,isBaseline) VALUES (?,?,'00000000','published',0,0,?,1)",
      )
      .run(id, id, Date.now());
    app.prepare("INSERT INTO MarketPublication(key,currentVersionId) VALUES ('global',?)").run(id);
  }
  app.exec('COMMIT');
} finally {
  app.close();
}
