import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { link, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { IngestionError } from '../errors.js';
import type { DiagnosticBundle, IssueExportInput } from '../issue-export-schema.js';

/**
 * Git 信息不可得时明确留空，不读取环境凭证推测部署版本。
 *
 * Missing Git evidence remains unknown; never inspect credentials to guess a deployment version.
 */
export async function diagnosticCodeIdentity(project: string): Promise<IssueExportInput['code']> {
  const execute = promisify(execFile);
  const options = { cwd: project, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } };
  try {
    const { stdout } = await execute('git', ['rev-parse', 'HEAD'], options);
    let sourceDirty: boolean | null = false;
    try {
      await execute(
        'git',
        ['diff', '--quiet', 'HEAD', '--', 'apps/api/src', 'apps/api/prisma'],
        options,
      );
      const untracked = await execute(
        'git',
        ['ls-files', '--others', '--exclude-standard', '--', 'apps/api/src', 'apps/api/prisma'],
        options,
      );
      sourceDirty = Boolean(untracked.stdout.trim());
    } catch (error) {
      sourceDirty =
        error && typeof error === 'object' && 'code' in error && error.code === 1 ? true : null;
    }

    return { commit: stdout.trim(), sourceDirty };
  } catch {
    return { commit: null, sourceDirty: null };
  }
}

/**
 * 先写私有临时文件，再排他发布；已有文件不覆盖，失败清理自建文件。
 *
 * Write a private temporary file and publish exclusively; never overwrite existing evidence.
 */
export async function writeIssueExportFile(
  filename: string,
  bundle: DiagnosticBundle,
  databaseFilename?: string,
): Promise<string> {
  const output = resolve(filename);
  if (databaseFilename) {
    const parent = await realpath(dirname(output));
    const canonicalOutput = join(parent, basename(output));
    const database = resolve(databaseFilename);
    const databasePaths = [
      await realpath(database),
      join(await realpath(dirname(database)), basename(database)),
    ];
    const protectedPaths = databasePaths.flatMap((path) => [
      path,
      `${path}-wal`,
      `${path}-shm`,
      `${path}-journal`,
    ]);
    if (protectedPaths.includes(canonicalOutput)) {
      throw new IngestionError('export_path_is_database');
    }
  }
  const directory = await mkdtemp(join(dirname(output), '.ingestion-export-'));
  const temporary = join(directory, 'diagnostics.json');
  try {
    await writeFile(temporary, JSON.stringify(bundle, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await link(temporary, output);

    return output;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      throw new IngestionError('export_file_exists', { cause: error });
    }
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
