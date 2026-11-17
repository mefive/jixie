// 在独立目录核验并恢复完整备份，不覆盖运行库。
// Restore and verify a complete bundle in a new directory without replacing live storage.
import { constants } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, readFile, realpath, rename } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { basename, dirname, join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';

const [input, output, flag, ...extra] = process.argv.slice(2);
if (
  !isAbsolute(input ?? '') ||
  !isAbsolute(output ?? '') ||
  (flag !== undefined && flag !== '--apply') ||
  extra.length
) {
  throw new Error('Usage: restore-market-backup.mjs /backup.bundle /new-directory [--apply]');
}
const bundle = await realpath(input);
const manifest = JSON.parse(await readFile(join(bundle, 'manifest.json'), 'utf8'));
if (
  typeof manifest.application !== 'string' ||
  basename(manifest.application) !== manifest.application ||
  !manifest.application.endsWith('.db') ||
  !Array.isArray(manifest.versions) ||
  manifest.versions.some(
    (path) =>
      typeof path !== 'string' ||
      !/^market\/versions\/[0-9A-HJKMNP-TV-Z]{26}\/market\.db$/.test(path),
  ) ||
  new Set(manifest.versions).size !== manifest.versions.length
) {
  throw new Error('Invalid backup manifest');
}
const appFile = join(bundle, manifest.application);
const app = new DatabaseSync(appFile, { readOnly: true });
let copy;
try {
  const pointer = app.prepare("SELECT * FROM MarketPublication WHERE key='global'").get();
  if (
    !pointer ||
    pointer.currentVersionId !== manifest.pointer.currentVersionId ||
    pointer.sequence !== manifest.pointer.sequence
  ) {
    throw new Error('Backup publication receipt mismatch');
  }
  const controls = app
    .prepare(
      'SELECT id,publishedAt FROM MarketVersion WHERE historyVersionId IS NULL AND (publishedAt IS NOT NULL OR (activeSlot=1 AND readyAt IS NOT NULL))',
    )
    .all();
  copy = new Map(
    controls.map((record) => [
      'market/versions/' + record.id + '/market.db',
      record.publishedAt !== null,
    ]),
  );
  if (
    !copy.has('market/versions/' + pointer.currentVersionId + '/market.db') ||
    manifest.versions.length !== copy.size ||
    manifest.versions.some((file) => !copy.has(file))
  ) {
    throw new Error('Incomplete market backup');
  }
} finally {
  app.close();
}
if (!flag) {
  console.log(
    JSON.stringify({
      mode: 'preview',
      output,
      versionFiles: copy.size,
      application: manifest.application,
    }),
  );
} else {
  const staging = output + '.restoring-' + randomUUID();
  await mkdir(staging, { mode: 0o700 });
  for (const [file, sealed] of [[manifest.application, false], ...copy]) {
    const source = join(bundle, file);
    if (!(await lstat(source)).isFile() || (await realpath(source)) !== source) {
      throw new Error('Invalid backup file');
    }
    const target = join(staging, file);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await copyFile(source, target, constants.COPYFILE_EXCL);
    const db = new DatabaseSync(target, { readOnly: true });
    try {
      if (
        db.prepare('PRAGMA quick_check').get().quick_check !== 'ok' ||
        db.prepare('PRAGMA foreign_key_check').get()
      ) {
        throw new Error('Invalid restored file: ' + file);
      }
    } finally {
      db.close();
    }
    await chmod(target, sealed ? 0o400 : 0o600);
  }
  await mkdir(output, { mode: 0o700 });
  await rename(staging, output);
  console.log(
    JSON.stringify({
      mode: 'restored',
      output,
      versionFiles: copy.size,
      application: manifest.application,
    }),
  );
}
