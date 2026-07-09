#!/usr/bin/env node
/**
 * Count lines of code under apps/ and packages/.
 *
 * Includes hand-written Prisma sources (schema.prisma, migrations/*.sql).
 * Excludes Prisma-generated client, build output, and dependency trees.
 *
 * Usage: node scripts/loc.mjs
 *    or: pnpm loc
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCOPES = ['apps', 'packages'];

/** Extensions counted as source (lowercase, no leading dot). */
const EXTENSIONS = new Set([
  // JS / TS
  'js',
  'mjs',
  'cjs',
  'mts',
  'cts',
  'ts',
  'tsx',
  'jsx',
  // Styles / markup
  'css',
  'scss',
  'sass',
  'less',
  'html',
  'svg',
  // Docs / config-as-code
  'md',
  'mdx',
  'json',
  'jsonc',
  'yaml',
  'yml',
  'toml',
  // Prisma + SQL migrations (hand-written)
  'prisma',
  'sql',
  // Shell / env examples
  'sh',
  'bash',
  'zsh',
]);

/** Directory names skipped anywhere in the path. */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.turbo',
  '.vite',
  '.cache',
  // Prisma-generated client (default lives under node_modules; also skip custom output dirs)
  'generated',
  '.prisma',
  // Local artifacts / design masters (see .gitignore)
  'acceptance',
  'design',
  'data',
]);

/**
 * Path segments that look like Prisma *generated* output, not hand-written schema/migrations.
 * Hand-written lives at apps/api/prisma/{schema.prisma,migrations/}.
 */
function isPrismaGeneratedPath(relativePath) {
  const parts = relativePath.split(path.sep);
  // .../prisma/generated/... or .../src/generated/prisma/...
  const prismaIdx = parts.indexOf('prisma');
  if (prismaIdx >= 0 && parts[prismaIdx + 1] === 'generated') {
    return true;
  }
  if (parts.includes('.prisma')) {
    return true;
  }
  // Custom client output folders sometimes named client under prisma/
  if (prismaIdx >= 0 && parts[prismaIdx + 1] === 'client' && parts.length > prismaIdx + 2) {
    return true;
  }
  return false;
}

function extensionOf(filePath) {
  const base = path.basename(filePath);
  if (base.startsWith('.') && !base.includes('.', 1)) {
    return null;
  }
  const ext = path.extname(base).slice(1).toLowerCase();
  return ext || null;
}

async function walk(dir, relativeRoot, onFile) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    const relative = path.join(relativeRoot, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      if (isPrismaGeneratedPath(relative)) {
        continue;
      }
      await walk(absolute, relative, onFile);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (isPrismaGeneratedPath(relative)) {
      continue;
    }

    const ext = extensionOf(absolute);
    if (!ext || !EXTENSIONS.has(ext)) {
      continue;
    }

    await onFile(absolute, relative, ext);
  }
}

function countLines(text) {
  if (text.length === 0) {
    return { total: 0, nonBlank: 0 };
  }
  // Split keeps a trailing empty string when file ends with \n — drop it so
  // "a\nb\n" counts as 2 lines, matching `wc -l`.
  const raw = text.split(/\r?\n/);
  if (raw.length > 0 && raw[raw.length - 1] === '') {
    raw.pop();
  }
  const total = raw.length;
  const nonBlank = raw.filter((line) => line.trim().length > 0).length;
  return { total, nonBlank };
}

function pad(value, width, align = 'right') {
  const text = String(value);
  if (text.length >= width) {
    return text;
  }
  const padding = ' '.repeat(width - text.length);
  return align === 'left' ? text + padding : padding + text;
}

function printTable(title, rows, columns) {
  console.log(`\n${title}`);
  console.log('─'.repeat(Math.min(72, title.length + 8)));

  const widths = columns.map((column) => {
    const headerWidth = column.label.length;
    const cellWidth = Math.max(0, ...rows.map((row) => String(row[column.key]).length));
    return Math.max(headerWidth, cellWidth);
  });

  console.log(
    columns
      .map((column, index) => pad(column.label, widths[index], column.align ?? 'right'))
      .join('  '),
  );

  for (const row of rows) {
    console.log(
      columns
        .map((column, index) => pad(row[column.key], widths[index], column.align ?? 'right'))
        .join('  '),
    );
  }
}

async function main() {
  /** @type {Map<string, { files: number, lines: number, nonBlank: number }>} */
  const byExtension = new Map();
  /** @type {Map<string, { files: number, lines: number, nonBlank: number }>} */
  const byScope = new Map();

  let fileCount = 0;
  let lineCount = 0;
  let nonBlankCount = 0;

  for (const scope of SCOPES) {
    const scopeRoot = path.join(ROOT, scope);
    try {
      await stat(scopeRoot);
    } catch {
      continue;
    }

    await walk(scopeRoot, scope, async (absolute, relative, ext) => {
      const text = await readFile(absolute, 'utf8');
      const { total, nonBlank } = countLines(text);

      fileCount += 1;
      lineCount += total;
      nonBlankCount += nonBlank;

      const extensionStats = byExtension.get(ext) ?? { files: 0, lines: 0, nonBlank: 0 };
      extensionStats.files += 1;
      extensionStats.lines += total;
      extensionStats.nonBlank += nonBlank;
      byExtension.set(ext, extensionStats);

      // apps/api/... → apps/api ; packages/shared/... → packages/shared
      const parts = relative.split(path.sep);
      const packageKey = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
      const scopeStats = byScope.get(packageKey) ?? { files: 0, lines: 0, nonBlank: 0 };
      scopeStats.files += 1;
      scopeStats.lines += total;
      scopeStats.nonBlank += nonBlank;
      byScope.set(packageKey, scopeStats);
    });
  }

  const extensionRows = [...byExtension.entries()]
    .map(([ext, stats]) => ({
      ext: `.${ext}`,
      files: stats.files,
      lines: stats.lines,
      nonBlank: stats.nonBlank,
    }))
    .sort((left, right) => right.lines - left.lines);

  const scopeRows = [...byScope.entries()]
    .map(([name, stats]) => ({
      name,
      files: stats.files,
      lines: stats.lines,
      nonBlank: stats.nonBlank,
    }))
    .sort((left, right) => right.lines - left.lines);

  console.log(`jixie LOC — scopes: ${SCOPES.join(', ')}`);
  console.log(`Excluded: ${[...SKIP_DIRS].join(', ')} (+ Prisma generated paths)`);

  printTable('By package', scopeRows, [
    { key: 'name', label: 'package', align: 'left' },
    { key: 'files', label: 'files' },
    { key: 'lines', label: 'lines' },
    { key: 'nonBlank', label: 'non-blank' },
  ]);

  printTable('By extension', extensionRows, [
    { key: 'ext', label: 'ext', align: 'left' },
    { key: 'files', label: 'files' },
    { key: 'lines', label: 'lines' },
    { key: 'nonBlank', label: 'non-blank' },
  ]);

  console.log('\nTotal');
  console.log('─'.repeat(24));
  console.log(`files:     ${fileCount}`);
  console.log(`lines:     ${lineCount}`);
  console.log(`non-blank: ${nonBlankCount}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
