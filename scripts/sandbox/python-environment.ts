import { spawn } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { RESEARCH_PYTHON_RUNTIME_CAPABILITIES_V1 as runtime } from '../../packages/shared/src/research-python-runtime.js';

export const interpreterValidation = [
  'import sys',
  `if sys.implementation.name != 'cpython' or '.'.join(map(str, sys.version_info[:2])) != '${runtime.python}':`,
  `    raise RuntimeError('Expected CPython ${runtime.python}')`,
].join('\n');

export const packageValidation = [
  interpreterValidation,
  'from importlib import import_module',
  'from importlib.metadata import version',
  `packages = ${JSON.stringify(runtime.packages.map(({ distribution, version, importNames }) => ({ distribution, version, importNames })))}`,
  'for package in packages:',
  '    actual = version(package["distribution"])',
  '    if actual != package["version"]:',
  "        raise RuntimeError(f\"{package['distribution']}=={actual}; expected {package['version']}\")",
  '    for name in package["importNames"]:',
  '        import_module(name)',
].join('\n');

interface RunOptions {
  directory: string;
  quiet?: boolean;
}

export function runPython(command: string, args: string[], options: RunOptions): Promise<void> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.directory,
      stdio: options.quiet ? ['ignore', 'ignore', 'pipe'] : 'inherit',
      env: { ...process.env, MPLBACKEND: 'Agg' },
    });
    let stderr = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-4_000);
    });
    child.once('error', rejectRun);
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolveRun();
      } else {
        rejectRun(new Error(`${command} exited with ${signal ?? code}: ${stderr.trim()}`));
      }
    });
  });
}

export async function ensurePythonEnvironment(
  directory: string,
  run = runPython,
  bootstrapExecutable = process.env.JIXIE_PYTHON_BOOTSTRAP_EXECUTABLE ?? `python${runtime.python}`,
): Promise<void> {
  const environmentDirectory = join(directory, '.venv', runtime.runtime);
  const executable = join(environmentDirectory, 'bin', 'python3');
  const requirements = join(directory, 'apps/sandboxd/python/requirements-research-runtime.txt');
  const exists = await lstat(environmentDirectory).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      return false;
    },
  );

  if (exists) {
    // Do not overwrite an existing environment with a broken or incompatible interpreter.
    await run(executable, ['-I', '-c', interpreterValidation], { directory, quiet: true }).catch(
      (error: unknown) => {
        throw new Error(
          `Invalid environment at ${environmentDirectory}. Move it aside and rerun pnpm setup:sandbox. ${String(error)}`,
        );
      },
    );
    try {
      await run(executable, ['-I', '-c', packageValidation], { directory, quiet: true });
      console.log(`[setup:sandbox] ${runtime.runtime} is current; installation skipped`);
      return;
    } catch {
      console.log('[setup:sandbox] dependencies need repair; installing pinned requirements');
    }
  } else {
    await run(bootstrapExecutable, ['-I', '-c', interpreterValidation], {
      directory,
      quiet: true,
    }).catch((error: unknown) => {
      throw new Error(
        `CPython ${runtime.python} is required. Set JIXIE_PYTHON_BOOTSTRAP_EXECUTABLE to its executable. ${String(error)}`,
      );
    });
    console.log(`[setup:sandbox] creating ${environmentDirectory}`);
    await run(bootstrapExecutable, ['-m', 'venv', environmentDirectory], { directory });
  }

  await run(
    executable,
    [
      '-m',
      'pip',
      'install',
      ...(exists ? ['--force-reinstall'] : []),
      '--disable-pip-version-check',
      '--requirement',
      requirements,
    ],
    { directory },
  );
  await run(executable, ['-I', '-c', packageValidation], { directory, quiet: true });
  console.log(`[setup:sandbox] ready: ${executable}`);
}
