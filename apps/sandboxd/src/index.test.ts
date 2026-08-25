import { spawn, type ChildProcess } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createConnection, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('sandboxd shutdown', () => {
  it('closes active clients and removes its socket on SIGTERM', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'jixie-sandboxd-shutdown-'));
    const socketPath = join(temporaryDirectory, 'sandboxd.sock');
    const runtimePath = join(temporaryDirectory, 'runtime');
    await writeFile(runtimePath, '#!/usr/bin/env node\nsetInterval(() => {}, 1_000);\n', {
      mode: 0o755,
    });

    const sandboxd = spawn(
      process.execPath,
      ['--import', 'tsx', resolve(appDirectory, 'src/index.ts')],
      {
        cwd: appDirectory,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          JIXIE_SANDBOX_SOCKET: socketPath,
          JIXIE_SANDBOXD_MODE: 'local',
          JIXIE_PYTHON_EXECUTABLE: runtimePath,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let client: Socket | undefined;
    let stderr = '';
    sandboxd.stderr?.setEncoding('utf8');
    sandboxd.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });

    try {
      await waitForSocket(socketPath, sandboxd, () => stderr);
      client = createConnection(socketPath);
      await new Promise<void>((resolveConnection, rejectConnection) => {
        client?.once('connect', resolveConnection);
        client?.once('error', rejectConnection);
      });
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));

      expect(sandboxd.kill('SIGTERM')).toBe(true);
      expect(await waitForExit(sandboxd, 5_000)).toBe(0);
      await expect(access(socketPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      client?.destroy();
      if (sandboxd.exitCode === null && sandboxd.signalCode === null) {
        sandboxd.kill('SIGKILL');
        await waitForExit(sandboxd, 1_000).catch(() => undefined);
      }
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }, 10_000);
});

async function waitForSocket(
  socketPath: string,
  child: ChildProcess,
  readStderr: () => string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await access(socketPath);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`sandboxd exited before creating its socket: ${readStderr()}`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error(`sandboxd did not create ${socketPath}: ${readStderr()}`);
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return child.exitCode;
  }

  return new Promise((resolveExit, rejectExit) => {
    const timeout = setTimeout(() => rejectExit(new Error('sandboxd did not exit')), timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      resolveExit(code);
    });
  });
}
