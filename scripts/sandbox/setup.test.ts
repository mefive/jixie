import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  parseSetupMode,
  projectDirectory,
  sandboxArtifacts,
  setupSandbox,
  synchronizeArtifacts,
} from './setup.js';
import {
  ensurePythonEnvironment,
  interpreterValidation,
  packageValidation,
  runPython,
} from './python-environment.js';

async function fixture(context: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'jixie-sandbox-setup-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'apps/sandboxd/python'), { recursive: true });
  return directory;
}

const environmentPath = (directory: string) => join(directory, '.venv/research-py-v1');

test('accepts only setup, check or help modes', () => {
  assert.equal(parseSetupMode([]), 'setup');
  assert.equal(parseSetupMode(['--check']), 'check');
  assert.equal(parseSetupMode(['--help']), 'help');
  assert.throws(() => parseSetupMode(['--unknown']), /Usage/);
  assert.throws(() => parseSetupMode(['--check', '--help']), /Usage/);
});

test('check reports every missing artifact without writes or environment preparation', async (context) => {
  const directory = await fixture(context);
  let prepared = false;
  await assert.rejects(
    setupSandbox(['--check'], directory, async () => {
      prepared = true;
    }),
    (error: Error) => {
      for (const artifact of sandboxArtifacts()) {
        assert.ok(error.message.includes(artifact.path));
      }
      return true;
    },
  );
  assert.equal(prepared, false);
  for (const artifact of sandboxArtifacts()) {
    await assert.rejects(stat(join(directory, artifact.path)), { code: 'ENOENT' });
  }
});

test('updates only changed files, keeps mtimes on repeated setup and skips Python in check mode', async (context) => {
  const directory = await fixture(context);
  assert.equal((await synchronizeArtifacts(directory, false)).length, 3);
  const artifacts = sandboxArtifacts();
  const before = await Promise.all(
    artifacts.map((artifact) => stat(join(directory, artifact.path))),
  );
  let preparations = 0;
  await setupSandbox([], directory, async () => {
    preparations++;
  });
  await setupSandbox(['--check'], directory, async () => {
    preparations++;
  });
  assert.equal(preparations, 1);
  for (const [index, artifact] of artifacts.entries()) {
    assert.equal((await stat(join(directory, artifact.path))).mtimeMs, before[index].mtimeMs);
  }
  await writeFile(join(directory, artifacts[0].path), 'old SDK');
  await assert.rejects(synchronizeArtifacts(directory, true), /jixie_research_sdk.pyi/);
  assert.equal(await readFile(join(directory, artifacts[0].path), 'utf8'), 'old SDK');
  assert.deepEqual(await synchronizeArtifacts(directory, false), [artifacts[0].path]);
});

test('fresh environment validates bootstrap, creates venv, installs and verifies', async (context) => {
  const directory = await fixture(context);
  const calls: Array<{ command: string; args: string[] }> = [];
  await ensurePythonEnvironment(
    directory,
    async (command, args) => {
      calls.push({ command, args });
    },
    '/fixture/python3.13',
  );
  assert.equal(calls.length, 4);
  assert.equal(calls[0].command, '/fixture/python3.13');
  assert.deepEqual(calls[0].args, ['-I', '-c', interpreterValidation]);
  assert.deepEqual(calls[1].args, ['-m', 'venv', environmentPath(directory)]);
  assert.equal(calls[2].command, join(environmentPath(directory), 'bin/python3'));
  assert.ok(calls[2].args.includes('--requirement'));
  assert.ok(!calls[2].args.includes('--force-reinstall'));
  assert.deepEqual(calls[3].args, ['-I', '-c', packageValidation]);
});

test('healthy environment does not call bootstrap or install', async (context) => {
  const directory = await fixture(context);
  await mkdir(environmentPath(directory), { recursive: true });
  const calls: string[][] = [];
  await ensurePythonEnvironment(
    directory,
    async (command, args) => {
      assert.equal(command, join(environmentPath(directory), 'bin/python3'));
      calls.push(args);
    },
    '/unavailable/bootstrap',
  );
  assert.deepEqual(calls, [
    ['-I', '-c', interpreterValidation],
    ['-I', '-c', packageValidation],
  ]);
});

test('changed or broken packages are reinstalled and verified afterwards', async (context) => {
  const directory = await fixture(context);
  await mkdir(environmentPath(directory), { recursive: true });
  const calls: string[][] = [];
  let validations = 0;
  await ensurePythonEnvironment(directory, async (_command, args) => {
    calls.push(args);
    if (args[2] === packageValidation && validations++ === 0) {
      throw new Error('wrong installed version');
    }
  });
  assert.equal(calls.length, 4);
  assert.ok(calls[2].includes('--force-reinstall'));
  assert.equal(validations, 2);
});

test('incompatible existing interpreter is preserved and never triggers installation', async (context) => {
  const directory = await fixture(context);
  await mkdir(environmentPath(directory), { recursive: true });
  const marker = join(environmentPath(directory), 'keep');
  await writeFile(marker, 'existing environment');
  let calls = 0;
  await assert.rejects(
    ensurePythonEnvironment(directory, async () => {
      calls++;
      throw new Error('wrong interpreter');
    }),
    /Move it aside/,
  );
  assert.equal(calls, 1);
  assert.equal(await readFile(marker, 'utf8'), 'existing environment');
});

test('missing bootstrap fails before environment creation', async (context) => {
  const directory = await fixture(context);
  let calls = 0;
  await assert.rejects(
    ensurePythonEnvironment(directory, async () => {
      calls++;
      throw new Error('not found');
    }),
    /JIXIE_PYTHON_BOOTSTRAP_EXECUTABLE/,
  );
  assert.equal(calls, 1);
  await assert.rejects(stat(environmentPath(directory)), { code: 'ENOENT' });
});

for (const failure of ['install', 'verification']) {
  test(`${failure} failure is propagated`, async (context) => {
    const directory = await fixture(context);
    await assert.rejects(
      ensurePythonEnvironment(directory, async (_command, args) => {
        if (
          (failure === 'install' && args.includes('pip')) ||
          (failure === 'verification' && args[2] === packageValidation)
        ) {
          throw new Error(`${failure} failed`);
        }
      }),
      new RegExp(`${failure} failed`),
    );
  });
}

test('help and invalid arguments do not prepare files or an environment', async (context) => {
  const directory = await fixture(context);
  const prepare = async () => {
    assert.fail('must not prepare environment');
  };
  await setupSandbox(['--help'], directory, prepare);
  await assert.rejects(setupSandbox(['--typo'], directory, prepare), /Usage/);
  await assert.rejects(stat(join(directory, sandboxArtifacts()[0].path)), { code: 'ENOENT' });
});

test('actual CLI help and invalid input work independently of cwd', async (context) => {
  const directory = await fixture(context);
  const tsx = join(projectDirectory, 'node_modules/tsx/dist/loader.mjs');
  const entry = join(projectDirectory, 'scripts/sandbox/setup.ts');
  for (const [arg, expected] of [
    ['--help', 0],
    ['--invalid', 1],
  ] as const) {
    const result = spawnSync(process.execPath, ['--import', tsx, entry, arg], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(result.status, expected, result.stderr);
    assert.match(result.stdout + result.stderr, /Usage: pnpm setup:sandbox/);
  }
});

test('subprocess failures retain diagnostics', async (context) => {
  const directory = await fixture(context);
  await assert.rejects(
    runPython(process.execPath, ['-e', 'console.error("fixture failure"); process.exit(7)'], {
      directory,
      quiet: true,
    }),
    /exited with 7: fixture failure/,
  );
});

test('build and typecheck use the read-only mode and replace the seven former scripts', async () => {
  const { scripts } = JSON.parse(await readFile(join(projectDirectory, 'package.json'), 'utf8'));
  assert.equal(scripts['setup:sandbox'], 'node --import tsx scripts/sandbox/setup.ts');
  for (const name of ['build', 'typecheck']) {
    assert.ok(scripts[name].includes('pnpm setup:sandbox --check &&'));
  }
  for (const name of [
    'gen:research-runtime',
    'check:research-runtime',
    'setup:research-python',
    'gen:research-sdk',
    'check:research-sdk',
    'gen:factor-sdk',
    'check:factor-sdk',
  ]) {
    assert.equal(scripts[name], undefined);
  }
});
