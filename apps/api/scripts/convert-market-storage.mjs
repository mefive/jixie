// 输入为停写后取得的同一组 SQLite 一致备份。转换只在新目录构造输出。
// Convert a coherent, quiesced set of backups into a new directory without modifying its inputs.
import { DatabaseSync } from 'node:sqlite';
import { mkdir, chmod, realpath, statfs, stat, writeFile, open, rename } from 'node:fs/promises';
import { dirname, join, basename, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import prisma from '@prisma/client';
import { ulid } from 'ulid';

const [sourcePath, destination, ...options] = process.argv.slice(2);
const usage =
  'Usage: convert-market-storage.mjs /snapshot/prod.db /new/layout [--candidate /snapshot/candidate.db] [--apply]';
if (!isAbsolute(sourcePath ?? '') || !isAbsolute(destination ?? '')) {
  throw new Error(usage);
}
const apply = options.at(-1) === '--apply';
if (apply) {
  options.pop();
}
if (
  options.length &&
  (options.length !== 2 || options[0] !== '--candidate' || !isAbsolute(options[1]))
) {
  throw new Error(usage);
}

const directory = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const uri = (filename) => pathToFileURL(filename).href + '?mode=ro';
const ident = (name) => '"' + name.replaceAll('"', '""') + '"';
const sourceFile = await realpath(sourcePath);
const source = new DatabaseSync(sourceFile, { readOnly: true });
const active = source.prepare('SELECT * FROM IngestionRun WHERE activeReplica=1').get();
const versions = source.prepare('SELECT * FROM IngestionRun ORDER BY startedAt,id').all();
const candidateFile = options.length ? await realpath(options[1]) : null;
if (
  Boolean(active) !== Boolean(candidateFile) ||
  active?.replicaOperation ||
  (active &&
    (!active.replicaReadyAt ||
      !['awaiting_publish', 'awaiting_repair', 'interrupted'].includes(active.replicaPhase)))
) {
  throw new Error('Expected exactly the ready unresolved candidate, without an active operation');
}
if (source.prepare("SELECT count(*) AS n FROM Job WHERE status='running'").get().n) {
  throw new Error('Drain running jobs before taking the source snapshot');
}
const verifiedTables = [];
const mark =
  source.prepare("SELECT revision FROM MarketDataState WHERE key='global'").get()?.revision ?? 0;
const baselineId = ulid();
const paths = {
  sourceFile,
  candidateFile,
  destination,
  revision: mark,
  activeRun: active?.id ?? null,
};
if (!apply) {
  console.log(JSON.stringify({ mode: 'preview', ...paths }, null, 2));
} else {
  if (active) {
    const originalCandidate = new DatabaseSync(candidateFile, { readOnly: true });
    try {
      const run = originalCandidate
        .prepare('SELECT replicaBaseline,targetDate,id FROM IngestionRun WHERE id=?')
        .get(active.id);
      if (
        run?.replicaBaseline !== active.replicaBaseline ||
        run?.targetDate !== active.targetDate
      ) {
        throw new Error('Candidate does not match legacy control record');
      }
    } finally {
      originalCandidate.close();
    }
    await verifyLegacyBaseline();
  }
  const free = await statfs(dirname(destination));
  const inputBytes =
    (await stat(sourceFile)).size + (candidateFile ? (await stat(candidateFile)).size : 0);
  if (free.bavail * free.bsize < 2 * inputBytes) {
    throw new Error('Insufficient free space for isolated conversion');
  }
  const staging = destination + '.creating-' + ulid();
  await mkdir(staging, { mode: 0o700 });
  const targetMarket = (id) => {
    if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) {
      throw new Error('Invalid version ID');
    }
    return join(staging, 'market', 'versions', id, 'market.db');
  };
  const baseFile = targetMarket(baselineId);
  const base = await convertFile(sourceFile, baseFile, 'market');
  try {
    // 旧主库的未决和拒绝 Run 是控制记录，不能当作已经发布的采集结果。
    // Exclude unpublished control records from the published market history.
    const remove = base.prepare('DELETE FROM IngestionRun WHERE id=?');
    for (const run of versions) {
      if (run.activeReplica || run.replicaPhase === 'rejected') {
        remove.run(run.id);
      }
    }
    base.exec('PRAGMA journal_mode=DELETE');
  } finally {
    base.close();
  }
  await chmod(baseFile, 0o400);
  if (active) {
    const db = await convertFile(candidateFile, targetMarket(active.id), 'market');
    try {
      const candidate = db.prepare('SELECT targetDate FROM IngestionRun WHERE id=?').get(active.id);
      if (candidate?.targetDate !== active.targetDate) {
        throw new Error('Candidate run identity mismatch');
      }
    } finally {
      db.close();
    }
  }

  const app = await convertFile(sourceFile, join(staging, basename(sourceFile)), 'app');
  try {
    app.exec('BEGIN IMMEDIATE');
    app
      .prepare("INSERT INTO MarketPublication(key,currentVersionId,sequence) VALUES ('global',?,?)")
      .run(baselineId, mark);
    // 迁移基线表示切换时可见的数据，既有 Run 的发布凭据保留在应用库。
    // The baseline holds the market visible at cutover; preserve old run receipts in application storage.
    app
      .prepare(
        "INSERT INTO MarketVersion(id,runId,parentSequence,selectionVersion,phase,publishedAt,targetDate,isBaseline) VALUES (?,?,0,0,'published',?,?,1)",
      )
      .run(
        baselineId,
        baselineId,
        Date.now(),
        versions.filter((r) => r.publishedAt).at(-1)?.targetDate ?? '00000000',
      );
    const insert = app.prepare(
      'INSERT INTO MarketVersion(id,runId,parentVersionId,parentSequence,selectionVersion,phase,activeSlot,readyAt,createdAt,finishedAt,publishedAt,publishedRevision,targetDate,trigger,rejectionReason,historyVersionId) VALUES (?,?,?,?,0,?,?,?,?,?,?,?,?,?,?,?)',
    );
    for (const run of versions) {
      insert.run(
        run.id,
        run.id,
        active?.id === run.id ? baselineId : null,
        mark,
        run.replicaPhase ?? run.status,
        run.activeReplica,
        run.replicaReadyAt,
        run.startedAt,
        run.finishedAt,
        run.publishedAt,
        run.publishedRevision,
        run.targetDate,
        run.trigger,
        run.rejectionReason,
        run.activeReplica ? null : baselineId,
      );
    }
    app
      .prepare("UPDATE Job SET marketVersionId=? WHERE status='queued' AND marketVersionId IS NULL")
      .run(baselineId);
    app.exec('COMMIT');
  } finally {
    app.close();
  }

  const proof = {
    ...paths,
    baselineId,
    appFile: basename(sourceFile),
    convertedAt: new Date().toISOString(),
    verifiedTables,
  };
  await writeFile(join(staging, 'conversion.json'), JSON.stringify(proof, null, 2), {
    flag: 'wx',
    mode: 0o600,
  });
  // 目标必须由本次操作独占；绝不替换旧库或已转换的工作目录。
  // Reserve an empty destination exclusively and never replace an existing deployment.
  await mkdir(destination, { mode: 0o700 });
  await rename(staging, destination);
  const parent = await open(dirname(destination), 'r');
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
  console.log(JSON.stringify({ mode: 'prepared', ...proof }, null, 2));
}
source.close();

async function verifyLegacyBaseline() {
  const client = new prisma.PrismaClient({ datasources: { db: { url: uri(sourceFile) } } });
  try {
    const revision = await client.marketDataState.findUnique({ where: { key: 'global' } });
    const selection = await client.ingestionSelection.findMany({ orderBy: { assetType: 'asc' } });
    const schema =
      await client.$queryRaw`SELECT name, type, sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY name`;
    const hash = createHash('sha256')
      .update(
        JSON.stringify(
          Object.entries({ revision, selection, schema }).sort(([a], [b]) => a.localeCompare(b)),
        ),
      )
      .digest('hex');
    if (hash !== active.replicaBaseline) {
      throw new Error('Legacy candidate baseline differs from the supplied main snapshot');
    }
  } finally {
    await client.$disconnect();
  }
}

async function convertFile(input, output, kind) {
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  const empty = await open(output, 'wx', 0o600);
  await empty.close();

  const envKey = kind === 'market' ? 'MARKET_DATABASE_URL' : 'DATABASE_URL';
  execFileSync(
    process.execPath,
    [
      require.resolve('prisma/build/index.js'),
      'migrate',
      'deploy',
      '--schema',
      join(directory, 'prisma', kind, 'schema.prisma'),
    ],
    { env: { ...process.env, [envKey]: 'file:' + output }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const db = new DatabaseSync(output);
  try {
    db.prepare('ATTACH DATABASE ? AS original').run(uri(input));
    db.exec('PRAGMA foreign_keys=ON; BEGIN; PRAGMA defer_foreign_keys=ON');
    const tables = db
      .prepare(
        "SELECT name FROM main.sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name!='_prisma_migrations'",
      )
      .all();
    const checks = [];
    for (const { name } of tables) {
      if (
        kind === 'app' &&
        ['MarketVersion', 'MarketPublication', 'MarketSelectionEdit', 'MarketRollback'].includes(
          name,
        )
      ) {
        continue;
      }
      const targetColumns = db.prepare("SELECT name FROM pragma_table_info(?, 'main')").all(name);
      const sourceColumns = new Set(
        db
          .prepare("SELECT name FROM pragma_table_info(?, 'original')")
          .all(name)
          .map((column) => column.name),
      );
      const columns = targetColumns.filter((column) => sourceColumns.has(column.name));
      if (
        !columns.length ||
        targetColumns.some(
          (c) =>
            !sourceColumns.has(c.name) &&
            !(
              [
                'Job',
                'ResearchExecution',
                'BacktestReport',
                'FactorReport',
                'StrategyScanReport',
              ].includes(name) && c.name === 'marketVersionId'
            ),
        )
      ) {
        throw new Error('Unsupported legacy schema: ' + name);
      }
      const list = columns.map((c) => ident(c.name)).join(', ');
      const table = ident(name);
      db.exec(`INSERT INTO main.${table} (${list}) SELECT ${list} FROM original.${table}`);
      const inserted = db.prepare('SELECT changes() AS n').get().n;
      const primaryKey = db
        .prepare("SELECT name FROM pragma_table_info(?, 'main') WHERE pk>0 ORDER BY pk")
        .all(name)
        .map((column) => ident(column.name))
        .join(',');
      if (!primaryKey) {
        throw new Error('Missing stable verification key: ' + name);
      }
      const projection = 'SELECT ' + list + ' FROM ' + table + ' ORDER BY ' + primaryKey;
      checks.push({ name, inserted, projection });
      if (inserted !== db.prepare(`SELECT count(*) AS n FROM original.${table}`).get().n) {
        throw new Error('Count mismatch: ' + name);
      }
    }
    if (db.prepare('PRAGMA main.foreign_key_check').get()) {
      throw new Error('Foreign key mismatch');
    }
    db.exec('COMMIT; DETACH DATABASE original');
    if (db.prepare('PRAGMA main.quick_check').get().quick_check !== 'ok') {
      throw new Error('Integrity check failed');
    }
    // 原生 SQLite 按主键顺序计算值摘要，不把整表加载到 JS 中。
    // Hash ordered values in SQLite without materializing whole tables in JavaScript.
    for (const check of checks) {
      const sql =
        "SELECT lower(hex(sha3_query('" + check.projection.replaceAll("'", "''") + "',256)))";
      const digest = (path) =>
        execFileSync('sqlite3', ['-readonly', '-bail', path, sql], { encoding: 'utf8' }).trim();
      const expected = digest(input);
      if (!/^[0-9a-f]{64}$/.test(expected) || expected !== digest(output)) {
        throw new Error('Field digest mismatch: ' + check.name);
      }
      verifiedTables.push({ input, table: check.name, rows: check.inserted, sha3: expected });
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
