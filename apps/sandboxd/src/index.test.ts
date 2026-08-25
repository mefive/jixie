import { spawn, type ChildProcess } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createConnection, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface ContainerInvocation {
  command: string;
  args: string[];
}

interface SandboxdHarness {
  sandboxd: ChildProcess;
  socketPath: string;
  invocationLogPath: string;
  temporaryDirectory: string;
  readStderr(): string;
}

describe('sandboxd container lifecycle', () => {
  it.each(['docker', 'podman'] as const)(
    'removes a disconnected %s container before releasing its session slot',
    async (mode) => {
      const harness = await startSandboxd({ mode });
      let firstClient: Socket | undefined;
      let secondClient: Socket | undefined;

      try {
        firstClient = await connectClient(harness.socketPath);
        await waitForInvocationCount(harness.invocationLogPath, 'run', 1);
        firstClient.destroy();
        await waitForInvocationCount(harness.invocationLogPath, 'rm', 1);
        await waitForInvocationCount(harness.invocationLogPath, 'inspect', 2);
        await delay(25);

        secondClient = await connectClient(harness.socketPath);
        await waitForInvocationCount(harness.invocationLogPath, 'run', 2);
        secondClient.destroy();
        await waitForInvocationCount(harness.invocationLogPath, 'rm', 2);
        const invocations = await waitForInvocationCount(harness.invocationLogPath, 'inspect', 4);

        expect(invocations.map((invocation) => invocation.command)).toEqual([
          'ps',
          'run',
          'inspect',
          'kill',
          'rm',
          'inspect',
          'run',
          'inspect',
          'kill',
          'rm',
          'inspect',
        ]);
        expect(invocations.filter((invocation) => invocation.command === 'rm')).toEqual([
          expect.objectContaining({ args: ['--force', expect.stringMatching(/^fake-/)] }),
          expect.objectContaining({ args: ['--force', expect.stringMatching(/^fake-/)] }),
        ]);
      } finally {
        firstClient?.destroy();
        secondClient?.destroy();
        await disposeHarness(harness);
      }
    },
    15_000,
  );

  it('force-removes a container when the sandbox session times out', async () => {
    const harness = await startSandboxd({ sessionTimeoutMs: 100 });
    let client: Socket | undefined;
    let output = '';

    try {
      client = await connectClient(harness.socketPath);
      client.setEncoding('utf8');
      client.on('data', (chunk: string) => {
        output += chunk;
      });
      const clientClosed = waitForSocketClose(client, 5_000);

      await waitForInvocationCount(harness.invocationLogPath, 'run', 1);
      await clientClosed;
      const invocations = await waitForInvocationCount(harness.invocationLogPath, 'rm', 1);

      expect(output).toContain('Python sandbox session exceeded 100ms');
      expect(invocations.map((invocation) => invocation.command)).toEqual([
        'ps',
        'run',
        'inspect',
        'kill',
        'rm',
        'inspect',
      ]);
    } finally {
      client?.destroy();
      await disposeHarness(harness);
    }
  }, 15_000);

  it('removes container state after an abnormal runtime exit', async () => {
    const harness = await startSandboxd({ runtimeExitCode: 17 });
    let client: Socket | undefined;
    let output = '';

    try {
      client = await connectClient(harness.socketPath);
      client.setEncoding('utf8');
      client.on('data', (chunk: string) => {
        output += chunk;
      });
      const clientClosed = waitForSocketClose(client, 5_000);

      await clientClosed;
      const invocations = await waitForInvocationCount(harness.invocationLogPath, 'rm', 1);

      expect(output).toContain('runtime exited with code 17');
      expect(invocations.map((invocation) => invocation.command)).toEqual([
        'ps',
        'run',
        'inspect',
        'kill',
        'rm',
        'inspect',
      ]);
    } finally {
      client?.destroy();
      await disposeHarness(harness);
    }
  }, 15_000);

  it('waits for active containers to be removed before exiting on SIGTERM', async () => {
    const harness = await startSandboxd();
    let client: Socket | undefined;

    try {
      client = await connectClient(harness.socketPath);
      await waitForInvocationCount(harness.invocationLogPath, 'run', 1);

      expect(harness.sandboxd.kill('SIGTERM')).toBe(true);
      expect(await waitForExit(harness.sandboxd, 5_000)).toBe(0);
      const invocations = await readInvocations(harness.invocationLogPath);

      expect(invocations.map((invocation) => invocation.command)).toEqual([
        'ps',
        'run',
        'inspect',
        'kill',
        'rm',
        'inspect',
      ]);
      await expect(access(harness.socketPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      client?.destroy();
      await disposeHarness(harness);
    }
  }, 15_000);

  it('removes labeled stale containers before accepting connections', async () => {
    const harness = await startSandboxd({ staleContainerId: 'stale-container' });

    try {
      const invocations = await waitForInvocationCount(harness.invocationLogPath, 'rm', 1);

      expect(invocations.map((invocation) => invocation.command)).toEqual([
        'ps',
        'inspect',
        'kill',
        'rm',
        'inspect',
      ]);
      expect(harness.readStderr()).toContain(
        'removed 1 stale docker sandbox container(s) during startup',
      );
    } finally {
      await disposeHarness(harness);
    }
  }, 15_000);

  it('retries removal until inspection confirms the container is absent', async () => {
    const harness = await startSandboxd({ removeFailures: 2 });
    let client: Socket | undefined;

    try {
      client = await connectClient(harness.socketPath);
      await waitForInvocationCount(harness.invocationLogPath, 'run', 1);
      client.destroy();
      await waitForInvocationCount(harness.invocationLogPath, 'rm', 3);
      const invocations = await waitForInvocationCount(harness.invocationLogPath, 'inspect', 4);

      expect(invocations.filter((invocation) => invocation.command === 'rm')).toHaveLength(3);
      expect(invocations.at(-1)?.command).toBe('inspect');
    } finally {
      client?.destroy();
      await disposeHarness(harness);
    }
  }, 15_000);

  it('reports a cleanup failure when removal cannot be verified', async () => {
    const harness = await startSandboxd({ removeFailures: 99, sessionTimeoutMs: 100 });
    let client: Socket | undefined;
    let output = '';

    try {
      client = await connectClient(harness.socketPath);
      client.setEncoding('utf8');
      client.on('data', (chunk: string) => {
        output += chunk;
      });
      const clientClosed = waitForSocketClose(client, 5_000);

      await waitForInvocationCount(harness.invocationLogPath, 'run', 1);
      await clientClosed;
      const invocations = await waitForInvocationCount(harness.invocationLogPath, 'rm', 3);

      expect(invocations.filter((invocation) => invocation.command === 'rm')).toHaveLength(3);
      expect(harness.readStderr()).toContain('failed to verify removal of docker sandbox');
      expect(output).toContain('Python sandbox cleanup failed');
    } finally {
      client?.destroy();
      await disposeHarness(harness);
    }
  }, 15_000);
});

async function startSandboxd(
  options: {
    mode?: 'docker' | 'podman';
    removeFailures?: number;
    runtimeExitCode?: number;
    sessionTimeoutMs?: number;
    staleContainerId?: string;
  } = {},
): Promise<SandboxdHarness> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'jixie-sandboxd-lifecycle-'));
  const socketPath = join(temporaryDirectory, 'sandboxd.sock');
  const invocationLogPath = join(temporaryDirectory, 'container-invocations.jsonl');
  const containerStatePath = join(temporaryDirectory, 'container-state.txt');
  const removeAttemptPath = join(temporaryDirectory, 'remove-attempts.txt');
  const mode = options.mode ?? 'docker';
  const runtimePath = join(temporaryDirectory, mode);
  await writeFile(runtimePath, fakeContainerRuntimeSource(), { mode: 0o755 });
  if (options.staleContainerId) {
    await writeFile(containerStatePath, `${options.staleContainerId}\n`);
  }

  const sandboxd = spawn(
    process.execPath,
    ['--import', 'tsx', resolve(appDirectory, 'src/index.ts')],
    {
      cwd: appDirectory,
      env: {
        ...process.env,
        PATH: `${temporaryDirectory}:${process.env.PATH ?? ''}`,
        NODE_ENV: 'test',
        JIXIE_SANDBOX_SOCKET: socketPath,
        JIXIE_SANDBOXD_MODE: mode,
        JIXIE_SANDBOX_MAX_SESSIONS: '1',
        JIXIE_SANDBOX_GRACEFUL_STOP_MS: '25',
        JIXIE_SANDBOX_SESSION_TIMEOUT_MS: String(options.sessionTimeoutMs ?? 5_000),
        JIXIE_TEST_CONTAINER_LOG: invocationLogPath,
        JIXIE_TEST_CONTAINER_STATE: containerStatePath,
        JIXIE_TEST_REMOVE_ATTEMPTS: removeAttemptPath,
        JIXIE_TEST_REMOVE_FAILURES: String(options.removeFailures ?? 0),
        ...(options.runtimeExitCode === undefined
          ? {}
          : { JIXIE_TEST_CONTAINER_EXIT_CODE: String(options.runtimeExitCode) }),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stderr = '';
  sandboxd.stderr?.setEncoding('utf8');
  sandboxd.stderr?.on('data', (chunk: string) => {
    stderr += chunk;
  });

  const harness: SandboxdHarness = {
    sandboxd,
    socketPath,
    invocationLogPath,
    temporaryDirectory,
    readStderr: () => stderr,
  };
  try {
    await waitForSocket(socketPath, sandboxd, harness.readStderr);
    return harness;
  } catch (error) {
    await disposeHarness(harness);
    throw error;
  }
}

function fakeContainerRuntimeSource(): string {
  return [
    '#!/usr/bin/env node',
    "const { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } = require('node:fs');",
    'const [command, ...args] = process.argv.slice(2);',
    'appendFileSync(process.env.JIXIE_TEST_CONTAINER_LOG, JSON.stringify({ command, args }) + "\\n");',
    'const statePath = process.env.JIXIE_TEST_CONTAINER_STATE;',
    'const currentId = () => existsSync(statePath) ? readFileSync(statePath, "utf8").trim() : "";',
    'const missing = () => { process.stderr.write("No such container\\n"); process.exit(1); };',
    'if (command === "ps") { const id = currentId(); if (id) process.stdout.write(id + "\\n"); process.exit(0); }',
    'if (command === "inspect") { if (currentId() === args[0]) process.exit(0); missing(); }',
    'if (command === "kill") {',
    '  if (currentId() !== args[0]) missing();',
    '  const pid = Number(args[0].replace(/^fake-/, ""));',
    '  if (Number.isInteger(pid)) { try { process.kill(pid, "SIGKILL"); } catch {} }',
    '  process.exit(0);',
    '}',
    'if (command === "rm") {',
    '  const target = args.at(-1);',
    '  if (currentId() !== target) missing();',
    '  const attemptPath = process.env.JIXIE_TEST_REMOVE_ATTEMPTS;',
    '  const attempts = existsSync(attemptPath) ? Number(readFileSync(attemptPath, "utf8")) : 0;',
    '  writeFileSync(attemptPath, String(attempts + 1));',
    '  if (attempts < Number(process.env.JIXIE_TEST_REMOVE_FAILURES)) {',
    '    process.stderr.write("simulated removal failure\\n");',
    '    process.exit(1);',
    '  }',
    '  unlinkSync(statePath);',
    '  process.exit(0);',
    '}',
    "if (command !== 'run') process.exit(2);",
    "const cidfile = args.find((argument) => argument.startsWith('--cidfile='));",
    'if (!cidfile) process.exit(2);',
    'const containerId = "fake-" + process.pid;',
    'writeFileSync(cidfile.slice(cidfile.indexOf("=") + 1), containerId + "\\n");',
    'writeFileSync(statePath, containerId + "\\n");',
    'const exitCode = Number(process.env.JIXIE_TEST_CONTAINER_EXIT_CODE);',
    'if (Number.isInteger(exitCode) && exitCode > 0) setTimeout(() => process.exit(exitCode), 25);',
    'const parentPid = process.ppid;',
    'process.stdin.resume();',
    'setInterval(() => {',
    '  try {',
    '    process.kill(parentPid, 0);',
    '  } catch {',
    '    process.exit(0);',
    '  }',
    '}, 25);',
    '',
  ].join('\n');
}

async function connectClient(socketPath: string): Promise<Socket> {
  const client = createConnection(socketPath);
  await new Promise<void>((resolveConnection, rejectConnection) => {
    client.once('connect', resolveConnection);
    client.once('error', rejectConnection);
  });
  return client;
}

async function waitForInvocationCount(
  invocationLogPath: string,
  command: string,
  count: number,
): Promise<ContainerInvocation[]> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const invocations = await readInvocations(invocationLogPath);
    if (invocations.filter((invocation) => invocation.command === command).length >= count) {
      return invocations;
    }
    await delay(25);
  }
  throw new Error(
    `container command ${command} did not run ${count} time(s): ${JSON.stringify(
      await readInvocations(invocationLogPath),
    )}`,
  );
}

async function readInvocations(invocationLogPath: string): Promise<ContainerInvocation[]> {
  const content = await readFile(invocationLogPath, 'utf8').catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return '';
      }
      throw error;
    },
  );
  return content
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ContainerInvocation);
}

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
    await delay(25);
  }
  throw new Error(`sandboxd did not create ${socketPath}: ${readStderr()}`);
}

function waitForSocketClose(client: Socket, timeoutMs: number): Promise<void> {
  if (client.destroyed) {
    return Promise.resolve();
  }
  return new Promise((resolveClose, rejectClose) => {
    const timeout = setTimeout(
      () => rejectClose(new Error('sandbox client did not close')),
      timeoutMs,
    );
    client.once('close', () => {
      clearTimeout(timeout);
      resolveClose();
    });
  });
}

async function disposeHarness(harness: SandboxdHarness): Promise<void> {
  if (harness.sandboxd.exitCode === null && harness.sandboxd.signalCode === null) {
    harness.sandboxd.kill('SIGTERM');
    await waitForExit(harness.sandboxd, 2_000).catch(async () => {
      harness.sandboxd.kill('SIGKILL');
      await waitForExit(harness.sandboxd, 1_000).catch(() => undefined);
    });
  }
  await rm(harness.temporaryDirectory, { recursive: true, force: true });
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
