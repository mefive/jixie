import { chmod, mkdir, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createServer, type Socket } from 'node:net';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { encodeFrame } from './frame.js';

const socketPath = process.env.JIXIE_SANDBOX_SOCKET ?? '/var/lib/jixie/sandboxd.sock';
const mode = process.env.JIXIE_SANDBOXD_MODE ?? 'podman';
const runtimeImage = process.env.JIXIE_PYTHON_IMAGE ?? 'jixie-python-runtime:py-v1';
const maxSessions = positiveInteger(process.env.JIXIE_SANDBOX_MAX_SESSIONS, 4);
const sessionTimeoutMs = positiveInteger(process.env.JIXIE_SANDBOX_SESSION_TIMEOUT_MS, 3_600_000);
const codeTimeoutSeconds = positiveNumber(process.env.JIXIE_PYTHON_CODE_TIMEOUT_SECONDS, 10);
const runnerPath = resolve(
  process.env.JIXIE_PYTHON_RUNNER ?? resolve(process.cwd(), 'python/jixie_runner.py'),
);

await mkdir(dirname(socketPath), { recursive: true });
await unlink(socketPath).catch((error: NodeJS.ErrnoException) => {
  if (error.code !== 'ENOENT') {
    throw error;
  }
});

const server = createServer((client) => serveSession(client));
server.listen(socketPath, async () => {
  await chmod(socketPath, 0o660);
  process.stdout.write(`[sandboxd] listening on ${socketPath} (${mode})\n`);
});

let activeSessions = 0;

function serveSession(client: Socket): void {
  if (activeSessions >= maxSessions) {
    client.end(
      encodeFrame({
        type: 'fatal',
        message: `Python sandbox is busy (${activeSessions}/${maxSessions} sessions)`,
      }),
    );
    return;
  }
  activeSessions += 1;

  let runtime: ChildProcessWithoutNullStreams;
  try {
    runtime = spawnRuntime();
  } catch (error) {
    activeSessions -= 1;
    client.end(
      encodeFrame({
        type: 'fatal',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return;
  }

  let stderr = '';
  let runtimeProducedOutput = false;
  let timedOut = false;
  let finished = false;
  const finishSession = () => {
    if (!finished) {
      finished = true;
      activeSessions -= 1;
    }
  };
  const timeout = setTimeout(() => {
    timedOut = true;
    runtime.kill('SIGKILL');
  }, sessionTimeoutMs);
  timeout.unref();
  runtime.stderr.setEncoding('utf8');
  runtime.stderr.on('data', (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-8_000);
  });
  runtime.stdout.on('data', () => {
    runtimeProducedOutput = true;
  });

  client.pipe(runtime.stdin);
  runtime.stdout.pipe(client, { end: false });

  const stop = () => {
    if (!runtime.killed) {
      runtime.kill('SIGKILL');
    }
  };
  client.once('close', stop);
  client.once('error', stop);
  runtime.once('error', (error) => {
    clearTimeout(timeout);
    finishSession();
    if (!client.destroyed) {
      client.end(encodeFrame({ type: 'fatal', message: error.message }));
    }
  });
  runtime.once('exit', (code, signal) => {
    clearTimeout(timeout);
    finishSession();
    client.off('close', stop);
    client.off('error', stop);
    if (!client.destroyed && (code !== 0 || signal)) {
      const detail = timedOut
        ? `Python sandbox session exceeded ${sessionTimeoutMs}ms`
        : stderr.trim() || `runtime exited with ${signal ?? `code ${code}`}`;
      if (timedOut || !runtimeProducedOutput) {
        client.write(encodeFrame({ type: 'fatal', message: detail }));
      }
    }
    client.end();
  });
}

function spawnRuntime(): ChildProcessWithoutNullStreams {
  if (mode === 'local') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('local sandbox mode is forbidden in production');
    }
    const executable = process.env.JIXIE_PYTHON_EXECUTABLE ?? 'python3';
    return spawn(executable, ['-I', '-u', runnerPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  }
  if (mode !== 'podman') {
    if (mode === 'docker') {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Docker sandbox mode is for local verification only');
      }
      return spawn(
        'docker',
        [
          'run',
          '--rm',
          '--interactive',
          '--pull=never',
          '--network=none',
          '--read-only',
          '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=64m',
          '--cap-drop=ALL',
          '--security-opt=no-new-privileges=true',
          '--pids-limit=64',
          '--memory=768m',
          '--memory-swap=1024m',
          '--cpus=1',
          '--user=65532:65532',
          `--env=JIXIE_PYTHON_CODE_TIMEOUT_SECONDS=${codeTimeoutSeconds}`,
          runtimeImage,
        ],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
    }
    throw new Error(`unknown JIXIE_SANDBOXD_MODE: ${mode}`);
  }

  return spawn(
    'podman',
    [
      'run',
      '--rm',
      '--interactive',
      '--pull=never',
      '--network=none',
      '--read-only',
      '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=64m',
      '--cap-drop=all',
      '--security-opt=no-new-privileges',
      '--pids-limit=64',
      '--memory=768m',
      '--memory-swap=1024m',
      '--cpus=1',
      `--timeout=${Math.ceil(sessionTimeoutMs / 1_000)}`,
      '--user=65532:65532',
      `--env=JIXIE_PYTHON_CODE_TIMEOUT_SECONDS=${codeTimeoutSeconds}`,
      runtimeImage,
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
}

function shutdown(): void {
  server.close(() => {
    void unlink(socketPath).finally(() => process.exit(0));
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`expected a positive integer, received ${value}`);
  }
  return parsed;
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`expected a positive number, received ${value}`);
  }
  return parsed;
}
