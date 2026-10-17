import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { RESEARCH_PYTHON_RUNTIME_CAPABILITIES_V1 as runtime } from '../../packages/shared/src/research-python-runtime.js';
import { packageValidation, type runPython } from './python-environment.js';
import {
  initializeTestPythonEnvironment,
  requireTestPythonEnvironment,
} from './test-python-environment.js';

const projectDirectory = fileURLToPath(new URL('../../', import.meta.url));
const defaultExecutable = join(projectDirectory, '.venv', runtime.runtime, 'bin', 'python3');

/**
 * 临时覆盖解释器并在用例结束时恢复，隔离入口环境回归场景。
 *
 * Override and restore interpreter selection to isolate entry-point regression scenarios.
 */
function overrideInterpreter(context: TestContext, executable?: string): void {
  const previous = process.env.JIXIE_PYTHON_EXECUTABLE;
  if (executable === undefined) {
    delete process.env.JIXIE_PYTHON_EXECUTABLE;
  } else {
    process.env.JIXIE_PYTHON_EXECUTABLE = executable;
  }

  context.after(() => {
    if (previous === undefined) {
      delete process.env.JIXIE_PYTHON_EXECUTABLE;
    } else {
      process.env.JIXIE_PYTHON_EXECUTABLE = previous;
    }
  });
}

async function temporaryDirectory(context: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'jixie-test-python-'));
  context.after(() => rm(directory, { recursive: true, force: true }));

  return directory;
}

test('resolves the project environment independently of cwd and validates the canonical contract', async (context) => {
  overrideInterpreter(context);
  const previousDirectory = process.cwd();
  const directory = await temporaryDirectory(context);
  const calls: Parameters<typeof runPython>[] = [];

  try {
    process.chdir(directory);
    const executable = await requireTestPythonEnvironment({
      run: async (...args) => {
        calls.push(args);
      },
    });

    assert.equal(executable, defaultExecutable);
    assert.deepEqual(calls, [
      [
        defaultExecutable,
        ['-I', '-c', packageValidation],
        { directory: projectDirectory, quiet: true },
      ],
    ]);
    assert.equal(process.env.JIXIE_PYTHON_EXECUTABLE, undefined);
  } finally {
    process.chdir(previousDirectory);
  }
});

test('validates an explicit override without replacing it with the project default', async (context) => {
  const executable = '/external/research/bin/python3';
  overrideInterpreter(context, executable);
  const calls: string[] = [];

  assert.equal(
    await requireTestPythonEnvironment({
      run: async (command) => {
        calls.push(command);
      },
    }),
    executable,
  );
  assert.deepEqual(calls, [executable]);
});

for (const diagnostic of [
  `Expected CPython ${runtime.python}`,
  `${runtime.packages[0].distribution}==0.0; expected ${runtime.packages[0].version}`,
]) {
  test(`preserves a validation failure without fallback: ${diagnostic}`, async (context) => {
    overrideInterpreter(context, '/invalid/research/bin/python3');
    const failure = new Error(diagnostic);
    const calls: string[] = [];

    await assert.rejects(
      requireTestPythonEnvironment({
        run: async (command) => {
          calls.push(command);
          throw failure;
        },
      }),
      (error: Error) => {
        assert.equal(error.cause, failure);
        assert.ok(error.message.includes(diagnostic));
        assert.match(error.message, /pnpm setup:sandbox/);
        assert.match(error.message, /System Python fallback is disabled/);

        return true;
      },
    );
    assert.deepEqual(calls, ['/invalid/research/bin/python3']);
  });
}

test('rejects an empty explicit override before spawning anything', async (context) => {
  overrideInterpreter(context, '');
  let called = false;

  await assert.rejects(
    requireTestPythonEnvironment({
      run: async () => {
        called = true;
      },
    }),
    /JIXIE_PYTHON_EXECUTABLE must not be empty/,
  );
  assert.equal(called, false);
});

test('missing environment does not invoke PATH Python, create a venv or install packages', async (context) => {
  overrideInterpreter(context);
  const directory = await temporaryDirectory(context);
  const marker = join(directory, 'system-python-called');
  const trap = join(directory, 'python3');
  await writeFile(
    trap,
    `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'called');\n`,
    { mode: 0o755 },
  );
  const previousPath = process.env.PATH;
  process.env.PATH = directory;

  try {
    await assert.rejects(requireTestPythonEnvironment({ directory }), /pnpm setup:sandbox/);
  } finally {
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
  }

  await assert.rejects(access(marker), { code: 'ENOENT' });
  await assert.rejects(access(join(directory, '.venv')), { code: 'ENOENT' });
});

test('initialization publishes the validated project interpreter to child processes', async (context) => {
  overrideInterpreter(context);
  const executable = await initializeTestPythonEnvironment();

  assert.equal(executable, defaultExecutable);
  const child = spawnSync(
    process.execPath,
    ['-e', 'console.log(process.env.JIXIE_PYTHON_EXECUTABLE)'],
    {
      encoding: 'utf8',
      timeout: 10_000,
    },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.trim(), defaultExecutable);
});

for (const application of ['api', 'sandboxd']) {
  test(`${application} Vitest rejects an invalid interpreter before collecting tests`, async (context) => {
    const directory = await temporaryDirectory(context);
    const appDirectory = join(projectDirectory, 'apps', application);
    const child = spawnSync(
      process.execPath,
      ['--conditions=development', join(appDirectory, 'node_modules/vitest/vitest.mjs'), 'run'],
      {
        cwd: appDirectory,
        env: { ...process.env, JIXIE_PYTHON_EXECUTABLE: join(directory, 'missing-python') },
        encoding: 'utf8',
        timeout: 20_000,
      },
    );

    assert.ifError(child.error);
    assert.notEqual(child.status, 0);
    assert.match(
      child.stdout + child.stderr,
      /Test Python environment is unavailable or incompatible/,
    );
    assert.match(child.stdout + child.stderr, /pnpm setup:sandbox/);
    assert.doesNotMatch(child.stdout + child.stderr, /Test Files|RUN {2}v/);
  });
}

test('API tests run without an interpreter override or a working PATH Python', async (context) => {
  const directory = await temporaryDirectory(context);
  const marker = join(directory, 'system-python-called');
  await writeFile(
    join(directory, 'python3'),
    `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'called');process.exit(91);\n`,
    { mode: 0o755 },
  );
  const environment: NodeJS.ProcessEnv = { ...process.env, PATH: directory };
  delete environment.JIXIE_PYTHON_EXECUTABLE;
  const appDirectory = join(projectDirectory, 'apps/api');
  const child = spawnSync(
    process.execPath,
    [
      '--conditions=development',
      join(appDirectory, 'node_modules/vitest/vitest.mjs'),
      'run',
      'src/factor/sdk/python-injection.test.ts',
    ],
    { cwd: appDirectory, env: environment, encoding: 'utf8', timeout: 30_000 },
  );

  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.match(child.stdout, /1 passed/);
  await assert.rejects(access(marker), { code: 'ENOENT' });
});
