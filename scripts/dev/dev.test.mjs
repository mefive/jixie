import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { processGroupIsRunning, signalProcessGroup, waitForServiceExit } from './process-group.mjs';

/**
 * 用隔离服务测试真实启动器，不访问工作数据库或实际 Python 环境。
 *
 * Exercise the real launcher with isolated services without opening the working database or Python.
 */
async function startFixture(context, pauseAt) {
  const directory = await mkdtemp(join(tmpdir(), 'jixie-dev-shutdown-'));
  const tracePath = join(directory, 'trace.jsonl');
  const executable = `#!${process.execPath}
const { appendFileSync } = require('node:fs');
const { createServer } = require('node:net');
const service = process.argv[2] === '-I' ? 'verification' : process.argv[3];
const record = (state, extra = {}) => appendFileSync(process.env.DEV_TEST_TRACE,
  JSON.stringify({ service, pid: process.pid, state, ...extra }) + '\\n');
record('started');
process.on('SIGINT', () => record('interrupted'));
process.on('SIGTERM', () => {});
if (process.env.DEV_TEST_PAUSE === service) {
  setInterval(() => {}, 1000);
} else if (service === 'verification') {
  process.exit(0);
} else {
  const address = service === 'sandboxd' ? process.env.JIXIE_SANDBOX_SOCKET : 0;
  createServer().listen(address, () => record('ready', { socket: process.env.JIXIE_SANDBOX_SOCKET }));
}
`;
  const pythonPath = join(directory, 'python');
  await writeFile(pythonPath, executable, { mode: 0o755 });
  await writeFile(join(directory, 'pnpm'), executable, { mode: 0o755 });

  // 延迟真实清单读取，确定性复现停止完成后才恢复启动逻辑的竞态。
  // Delay the real manifest read to reproduce startup resuming after shutdown completes.
  const preloadPath = join(directory, 'delay-requirements.mjs');
  await writeFile(
    preloadPath,
    `
import filesystem from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
const readFile = filesystem.readFile;
filesystem.readFile = async (filename, ...options) => {
  if (String(filename).endsWith('requirements-research-runtime.txt')) {
    appendFileSync(process.env.DEV_TEST_TRACE,
      JSON.stringify({ service: 'requirements', state: 'started', pid: process.pid }) + '\\n');
    await delay(250);
  }
  return readFile(filename, ...options);
};
syncBuiltinESMExports();
`,
  );

  const argumentsList = pauseAt === 'requirements' ? ['--import', preloadPath] : [];
  argumentsList.push(fileURLToPath(new URL('./dev.mjs', import.meta.url)));

  const launcher = spawn(process.execPath, argumentsList, {
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      JIXIE_PYTHON_EXECUTABLE: pythonPath,
      DEV_TEST_TRACE: tracePath,
      DEV_TEST_PAUSE: pauseAt,
    },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(launcher, 'exit');
  let output = '';
  launcher.stdout.on('data', (chunk) => (output += chunk));
  launcher.stderr.on('data', (chunk) => (output += chunk));

  async function trace() {
    const contents = await readFile(tracePath, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') {
        return '';
      }
      throw error;
    });

    return contents
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  context.after(async () => {
    signalProcessGroup(launcher, 'SIGKILL');
    const entries = await trace();
    for (const entry of entries) {
      if (entry.state === 'started') {
        signalProcessGroup({ pid: entry.pid }, 'SIGKILL');
        await waitForServiceExit({ pid: entry.pid }, 1_000);
      }
    }

    await waitForServiceExit(launcher, 1_000);
    const socket = entries.find((entry) => entry.socket)?.socket;
    if (socket) {
      await unlink(socket).catch((error) => {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      });
    }

    await rm(directory, { recursive: true, force: true });
  });

  async function waitForRecord(service, state) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if ((await trace()).some((entry) => entry.service === service && entry.state === state)) {
        return;
      }
      assert.equal(launcher.exitCode, null, output);
      await delay(25);
    }
    assert.fail(`Timed out waiting for ${service}/${state}: ${output}`);
  }

  async function assertStopped() {
    const result = await Promise.race([
      exited,
      delay(6_000, undefined, { ref: false }).then(() =>
        assert.fail(`Shutdown timed out: ${output}`),
      ),
    ]);
    assert.deepEqual(result, [0, null], output);
    assert.match(output, /\[dev\] services stopped/);

    const entries = await trace();
    for (const entry of entries.filter((entry) => entry.state === 'started')) {
      assert.equal(processGroupIsRunning({ pid: entry.pid }), false, entry.service);
    }

    return entries;
  }

  return { launcher, waitForRecord, assertStopped };
}

test(
  'repeated interrupts finish cleanup of every detached service group',
  {
    skip: process.platform === 'win32',
  },
  async (context) => {
    const fixture = await startFixture(context, '');
    await fixture.waitForRecord('api', 'ready');
    await fixture.waitForRecord('web', 'ready');

    fixture.launcher.kill('SIGINT');
    await fixture.waitForRecord('web', 'interrupted');
    fixture.launcher.kill('SIGINT');

    const entries = await fixture.assertStopped();
    const socket = entries.find(
      (entry) => entry.service === 'sandboxd' && entry.state === 'ready',
    ).socket;
    await assert.rejects(readFile(socket), { code: 'ENOENT' });
  },
);

for (const [service, expectedStarted] of [
  ['requirements', ['requirements']],
  ['verification', ['verification']],
  ['sandboxd', ['verification', 'sandboxd']],
]) {
  test(
    `interrupt during ${service} startup does not start later services`,
    {
      skip: process.platform === 'win32',
    },
    async (context) => {
      const fixture = await startFixture(context, service);
      await fixture.waitForRecord(service, 'started');

      fixture.launcher.kill('SIGINT');
      const entries = await fixture.assertStopped();
      const started = entries
        .filter((entry) => entry.state === 'started')
        .map((entry) => entry.service);

      assert.deepEqual(started, expectedStarted);
    },
  );
}
