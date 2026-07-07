import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Back up the SQLite database — the one file that can wipe out everything (market data = weeks of
 * rate-limited re-sync; strategies / research history / backtest records = unrecoverable). The DB runs in
 * WAL mode, so a plain `cp` can tear a half-written page: we go through SQLite's online `.backup`, which
 * snapshots a consistent copy even while the api is running.
 *
 * Plain .mjs on purpose: infra scripts must run anywhere `node` runs (a lean prod VPS with no tsx / no
 * build step, invoked from cron / systemd). Zero npm deps — only node built-ins + the `sqlite3` CLI.
 *
 * Writes a timestamped copy to a directory OUTSIDE the repo (default ~/jixie-backups), verifies it opens,
 * then rotates to the newest N. On a single VPS the real durability win is pushing that directory OFF the
 * box (rsync to another host / object storage / litestream) — a local-only copy dies with the disk.
 *
 * Usage: pnpm --filter api backup   (or: node apps/api/scripts/backup-db.mjs)
 *   env JIXIE_DB_PATH      source db (default: apps/api/prisma/dev.db next to this script)
 *   env JIXIE_BACKUP_DIR   backup directory (default ~/jixie-backups)
 *   env JIXIE_BACKUP_KEEP  how many copies to retain (default 5)
 *
 * Restore: stop the api, then `cp <backup>/dev-YYYYMMDD-HHMMSS.db <db path>` and delete any stale
 * `dev.db-wal` / `dev.db-shm` next to it (the backup is a fully checkpointed single file).
 */
const scriptDir = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.JIXIE_DB_PATH || join(scriptDir, '..', 'prisma', 'dev.db');
const backupDir = process.env.JIXIE_BACKUP_DIR || join(homedir(), 'jixie-backups');
const keep = Math.max(1, Number(process.env.JIXIE_BACKUP_KEEP) || 5);

const mib = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

function sqlite3(args) {
  return execFileSync('sqlite3', args, { encoding: 'utf8' }).trim();
}

function main() {
  // Preflight: sqlite3 CLI present, source DB exists.
  try {
    sqlite3(['-version']);
  } catch {
    throw new Error(
      'sqlite3 CLI not found — install it and retry (macOS ships it; Ubuntu: apt install sqlite3; CentOS: yum install sqlite)',
    );
  }
  if (!existsSync(dbPath)) {
    throw new Error(`database not found: ${dbPath}`);
  }

  mkdirSync(backupDir, { recursive: true });
  const stamp = timestamp();
  const dest = join(backupDir, `dev-${stamp}.db`);

  // Online backup — consistent snapshot under WAL, safe while the api holds the DB open.
  console.log(`[backup] ${mib(statSync(dbPath).size)} → ${dest}`);
  const started = Date.now();
  sqlite3([dbPath, `.backup '${dest}'`]);

  // Verify the copy is a readable SQLite file (catches truncation / a failed backup) before we trust it
  // enough to rotate old ones out. A cheap open + count, not a full integrity_check (6GB would be slow).
  let tableCount;
  try {
    tableCount = sqlite3([dest, 'SELECT count(*) FROM sqlite_master;']);
    if (!(Number(tableCount) > 0)) {
      throw new Error('sqlite_master is empty');
    }
  } catch (e) {
    unlinkSync(dest); // don't leave a corrupt copy that rotation might keep
    throw new Error(
      `backup verification failed, corrupt copy deleted: ${e instanceof Error ? e.message : e}`,
    );
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[backup] done ${mib(statSync(dest).size)} · ${tableCount} tables · ${secs}s`);

  rotate();
}

/** Keep the newest `keep` backups, delete the rest (names sort lexically = chronologically). */
function rotate() {
  const backups = readdirSync(backupDir)
    .filter((name) => /^dev-\d{8}-\d{6}\.db$/.test(name))
    .sort()
    .reverse();
  const stale = backups.slice(keep);
  for (const name of stale) {
    unlinkSync(join(backupDir, name));
  }
  console.log(
    `[backup] kept ${Math.min(backups.length, keep)}/${backups.length}` +
      (stale.length ? ` · deleted ${stale.length} old backup(s)` : ''),
  );
}

/** Local-time YYYYMMDD-HHMMSS (sorts chronologically, human-readable in the filename). */
function timestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

main();
