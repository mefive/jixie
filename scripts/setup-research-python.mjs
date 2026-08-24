#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');
const environmentDirectory = join(projectDirectory, '.venv', 'research-py-v1');
const requirementsPath = join(
  projectDirectory,
  'apps',
  'sandboxd',
  'python',
  'requirements-research-runtime.txt',
);

void main().catch((error) => {
  console.error(
    `[setup:research-python] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});

async function main() {
  const bootstrapExecutable =
    process.env.JIXIE_PYTHON_BOOTSTRAP_EXECUTABLE ??
    (await firstAvailableExecutable(['python3.13']));
  try {
    await run(
      bootstrapExecutable,
      ['-c', 'import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 13) else 1)'],
      { quiet: true },
    );
  } catch {
    throw new Error(`${bootstrapExecutable} must be CPython 3.13 for research-py-v1.`);
  }
  console.log(`[setup:research-python] creating ${environmentDirectory}`);
  await run(bootstrapExecutable, ['-m', 'venv', environmentDirectory]);

  const environmentPython = join(environmentDirectory, 'bin', 'python3');
  console.log('[setup:research-python] installing fixed research-py-v1 packages');
  await run(environmentPython, [
    '-m',
    'pip',
    'install',
    '--disable-pip-version-check',
    '--requirement',
    requirementsPath,
  ]);
  console.log(`[setup:research-python] ready: ${environmentPython}`);
}

async function firstAvailableExecutable(candidates) {
  for (const candidate of candidates) {
    try {
      await run(candidate, ['--version'], { quiet: true });
      return candidate;
    } catch {
      // Try the next explicit interpreter candidate.
    }
  }
  throw new Error(
    'Python 3.13 was not found. Set JIXIE_PYTHON_BOOTSTRAP_EXECUTABLE to an explicit CPython 3.13 interpreter.',
  );
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectDirectory,
      stdio: options.quiet ? 'ignore' : 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with ${signal ?? `code ${code ?? 1}`}`));
    });
  });
}
