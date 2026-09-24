import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { e2eCommands, imageCommands } from './commands.mjs';
import { executeCommand, runCommands, selectCommands } from './run.mjs';

const executeFile = promisify(execFile);
const repositoryDirectory = fileURLToPath(new URL('../../', import.meta.url));

test('help and list never select execution; unknown input is rejected', () => {
  for (const args of [[], ['--help'], ['--list'], ['--', '--list']]) {
    assert.equal(selectCommands(args, e2eCommands).list, true);
  }
  assert.equal(selectCommands(['research-autosave', '--help'], e2eCommands).list, true);
  assert.equal(selectCommands(['--group', 'research', '--list'], e2eCommands).list, true);
  for (const args of [
    ['missing'],
    ['--group'],
    ['--group', 'missing'],
    ['research-autosave', '--typo'],
  ]) {
    assert.throws(() => selectCommands(args, e2eCommands));
  }
});

test('learning group retains its original sequence and separate image tasks', () => {
  assert.deepEqual(
    selectCommands(['--group', 'learning'], e2eCommands).commands.map((command) => command.name),
    [
      'learning-cross-market',
      'learning-trend-strategy',
      'learning-value-factor',
      'learning-cgb-signal',
      'learning-stock-bond-allocation',
      'learning-commodity-carry',
      'learning-sales-yield-positive',
    ],
  );
  assert.equal(
    e2eCommands.some((command) => command.file.includes('help-content')),
    false,
  );
  assert.equal(imageCommands.length, 18);
  assert.deepEqual(e2eCommands.find((command) => command.name === 'research-fcff-reuse').nodeArgs, [
    '--import',
    'tsx',
  ]);
});

test('catalog covers every runnable browser file exactly once and excludes fixtures', async () => {
  const commands = [...e2eCommands, ...imageCommands];
  for (const catalog of [e2eCommands, imageCommands]) {
    assert.equal(new Set(catalog.map((command) => command.name)).size, catalog.length);
  }
  const helpers = new Set([
    'research-cell-change-fixture.mjs',
    'research-clarification-fixture.mjs',
    'technical-indicator-strategy.mjs',
  ]);
  const files = [];
  const staticChecks = new Set([
    'apps/docs/e2e/help-content.mjs',
    'apps/docs/e2e/help-content.test.mjs',
  ]);
  for (const directory of ['apps/web/e2e', 'apps/docs/e2e']) {
    for (const filename of await readdir(join(repositoryDirectory, directory))) {
      if (
        filename.endsWith('.mjs') &&
        !helpers.has(filename) &&
        !staticChecks.has(`${directory}/${filename}`)
      ) {
        files.push(`${directory}/${filename}`);
      }
    }
  }
  assert.deepEqual(commands.map((command) => command.file).sort(), files.sort());
});

test('groups stop at first failure and report skipped tasks', async () => {
  const executed = [];
  const output = [];
  const commands = ['first', 'second', 'third'].map((name) => ({ name }));
  const code = await runCommands(
    commands,
    async (command) => {
      executed.push(command.name);
      return command.name === 'second' ? 7 : 0;
    },
    (message) => output.push(message),
  );
  assert.equal(code, 7);
  assert.deepEqual(executed, ['first', 'second']);
  assert.match(output.at(-1), /1 passed, 1 not run/);
});

test('runner preserves app cwd, inherited environment, Node flags and exit status', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'jixie-command-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'e2e'));
  const entry = join(directory, 'e2e/fixture.mjs');
  await writeFile(
    entry,
    `import { writeFileSync } from 'node:fs';
writeFileSync('result.json', JSON.stringify({ cwd: process.cwd(), flags: process.execArgv, path: process.env.PATH }));
process.exitCode = 7;
`,
  );
  assert.equal(
    await executeCommand({ name: 'fixture', file: entry, nodeArgs: ['--no-warnings'] }),
    7,
  );
  const result = JSON.parse(await readFile(join(directory, 'result.json'), 'utf8'));
  assert.equal(result.cwd, await realpath(directory));
  assert.deepEqual(result.flags, ['--no-warnings']);
  assert.equal(result.path, process.env.PATH);
});

test('actual CLI lists tasks without starting a browser and fails unknown tasks', async () => {
  for (const entry of ['run.mjs', 'docs-images.mjs']) {
    const file = fileURLToPath(new URL(entry, import.meta.url));
    const result = await executeFile(process.execPath, [file, '--list'], { cwd: tmpdir() });
    assert.match(result.stdout, /Usage: pnpm/);
    await assert.rejects(executeFile(process.execPath, [file, 'nonexistent']), { code: 1 });
  }
});

test(
  'runner cleans descendants after a successful script exits',
  { skip: process.platform === 'win32', timeout: 10_000 },
  async (context) => {
    const directory = await mkdtemp(join(tmpdir(), 'jixie-command-descendant-'));
    let descendantPid;
    context.after(async () => {
      if (descendantPid) {
        try {
          process.kill(descendantPid, 'SIGKILL');
        } catch (error) {
          if (error.code !== 'ESRCH') {
            throw error;
          }
        }
      }
      await rm(directory, { recursive: true, force: true });
    });
    const entry = join(directory, 'fixture.mjs');
    const pidFile = join(directory, 'descendant.pid');
    await writeFile(
      entry,
      `import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
child.unref();
`,
    );
    const code = await executeCommand({ name: 'descendant-fixture', file: entry });
    descendantPid = Number(await readFile(pidFile, 'utf8'));
    assert.equal(code, 0);
    assert.throws(() => process.kill(descendantPid, 0), { code: 'ESRCH' });
  },
);

test(
  'SIGTERM interrupts the active group and never runs the next task',
  { skip: process.platform === 'win32', timeout: 15_000 },
  async (context) => {
    const directory = await mkdtemp(join(tmpdir(), 'jixie-command-signal-'));
    const runUrl = new URL('./run.mjs', import.meta.url).href;
    const slow = join(directory, 'slow.mjs');
    const next = join(directory, 'next.mjs');
    await writeFile(slow, "console.log('fixture-ready'); setInterval(() => {}, 1000);");
    await writeFile(next, "console.log('must-not-run');");
    const launcher = join(directory, 'launcher.mjs');
    await writeFile(
      launcher,
      `import { runCommands } from ${JSON.stringify(runUrl)};
process.exitCode = await runCommands(${JSON.stringify([
        { name: 'slow', file: slow },
        { name: 'next', file: next },
      ])});`,
    );
    const child = spawn(process.execPath, [launcher], { stdio: ['ignore', 'pipe', 'pipe'] });
    context.after(async () => {
      child.kill('SIGTERM');
      await rm(directory, { recursive: true, force: true });
    });
    let output = '';
    const finished = once(child, 'exit');
    await new Promise((resolveReady, reject) => {
      child.once('error', reject);
      child.once('exit', () => reject(new Error('Runner exited before fixture readiness')));
      child.stdout.on('data', (chunk) => {
        output += chunk;
        if (output.includes('fixture-ready')) {
          resolveReady();
        }
      });
    });
    child.kill('SIGTERM');
    const [code] = await finished;
    assert.equal(code, 143);
    assert.doesNotMatch(output, /must-not-run/);
    assert.match(output, /1 not run/);
  },
);
