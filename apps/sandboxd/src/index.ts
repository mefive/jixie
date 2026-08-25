import { createHash } from 'node:crypto';
import { chmod, mkdir, unlink } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { dirname, resolve } from 'node:path';
import { encodeFrame } from './frame.js';
import {
  cleanupStaleSandboxRuntimes,
  spawnSandboxRuntime,
  type RuntimeStopReason,
  type SandboxRuntime,
} from './runtime.js';

const socketPath = process.env.JIXIE_SANDBOX_SOCKET ?? '/var/lib/jixie/sandboxd.sock';
const mode = process.env.JIXIE_SANDBOXD_MODE ?? 'podman';
const runtimeImage = process.env.JIXIE_PYTHON_IMAGE ?? 'jixie-python-runtime:py-v1';
const maxSessions = positiveInteger(process.env.JIXIE_SANDBOX_MAX_SESSIONS, 4);
const sessionTimeoutMs = positiveInteger(process.env.JIXIE_SANDBOX_SESSION_TIMEOUT_MS, 3_600_000);
const gracefulStopMs = positiveInteger(process.env.JIXIE_SANDBOX_GRACEFUL_STOP_MS, 500);
const codeTimeoutSeconds = positiveNumber(process.env.JIXIE_PYTHON_CODE_TIMEOUT_SECONDS, 10);
const runnerPath = resolve(
  process.env.JIXIE_PYTHON_RUNNER ?? resolve(process.cwd(), 'python/jixie_runner.py'),
);
const runtimeOwnerId = createHash('sha256').update(socketPath).digest('hex').slice(0, 32);
const writeWarning = (message: string): void => {
  process.stderr.write(`[sandboxd] ${message}\n`);
};

await cleanupStaleSandboxRuntimes({
  mode,
  nodeEnvironment: process.env.NODE_ENV,
  ownerId: runtimeOwnerId,
  onWarning: writeWarning,
});
await mkdir(dirname(socketPath), { recursive: true });
await unlink(socketPath).catch((error: NodeJS.ErrnoException) => {
  if (error.code !== 'ENOENT') {
    throw error;
  }
});

const server = createServer((client) => serveSession(client));
const clients = new Set<Socket>();
const sessionCompletions = new Set<Promise<void>>();
let activeSessions = 0;
let shuttingDown = false;

server.listen(socketPath, async () => {
  await chmod(socketPath, 0o660);
  process.stdout.write(`[sandboxd] listening on ${socketPath} (${mode})\n`);
});

function serveSession(client: Socket): void {
  clients.add(client);
  client.once('close', () => clients.delete(client));

  if (shuttingDown) {
    client.destroy();
    return;
  }
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
  const completion = runSession(client)
    .catch((error: unknown) => {
      sendFatal(client, error instanceof Error ? error.message : String(error));
    })
    .finally(() => {
      activeSessions -= 1;
      sessionCompletions.delete(completion);
    });
  sessionCompletions.add(completion);
}

async function runSession(client: Socket): Promise<void> {
  const runtime = await spawnSandboxRuntime({
    mode,
    nodeEnvironment: process.env.NODE_ENV,
    runtimeImage,
    runnerPath,
    pythonExecutable: process.env.JIXIE_PYTHON_EXECUTABLE ?? 'python3',
    codeTimeoutSeconds,
    sessionTimeoutMs,
    gracefulStopMs,
    ownerId: runtimeOwnerId,
    onWarning: writeWarning,
  });

  if (client.destroyed || shuttingDown) {
    await runtime.stop('graceful');
    return;
  }

  await bridgeSession(client, runtime);
}

function bridgeSession(client: Socket, runtime: SandboxRuntime): Promise<void> {
  return new Promise((resolveSession) => {
    let stderr = '';
    let runtimeProducedOutput = false;
    let finished = false;
    const timeout = setTimeout(() => {
      void finishSession('force', {
        fatalMessage: `Python sandbox session exceeded ${sessionTimeoutMs}ms`,
      });
    }, sessionTimeoutMs);
    timeout.unref();

    runtime.child.stderr.setEncoding('utf8');
    runtime.child.stderr.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-8_000);
    });
    runtime.child.stdout.on('data', () => {
      runtimeProducedOutput = true;
    });

    client.pipe(runtime.child.stdin);
    runtime.child.stdout.pipe(client, { end: false });

    const handleClientClose = (): void => {
      void finishSession('graceful');
    };
    const handleClientError = (): void => {
      void finishSession('graceful');
    };
    const handleRuntimeError = (error: Error): void => {
      void finishSession('exited', { fatalMessage: error.message });
    };
    const handleRuntimeExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      const abnormalExit = code !== 0 || signal !== null;
      const fatalMessage =
        abnormalExit && !runtimeProducedOutput
          ? stderr.trim() || `runtime exited with ${signal ?? `code ${code}`}`
          : undefined;
      void finishSession('exited', { fatalMessage });
    };

    client.once('close', handleClientClose);
    client.once('error', handleClientError);
    runtime.child.once('error', handleRuntimeError);
    runtime.child.once('exit', handleRuntimeExit);

    async function finishSession(
      reason: RuntimeStopReason,
      result: { fatalMessage?: string } = {},
    ): Promise<void> {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeout);
      client.off('close', handleClientClose);
      client.off('error', handleClientError);
      runtime.child.off('error', handleRuntimeError);
      runtime.child.off('exit', handleRuntimeExit);

      try {
        await runtime.stop(reason);
        if (result.fatalMessage) {
          sendFatal(client, result.fatalMessage);
        }
        if (!client.destroyed) {
          client.end();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        writeWarning(message);
        sendFatal(client, `Python sandbox cleanup failed: ${message}`);
      } finally {
        resolveSession();
      }
    }
  });
}

function sendFatal(client: Socket, message: string): void {
  if (!client.destroyed && client.writable) {
    client.end(encodeFrame({ type: 'fatal', message }));
  }
}

function shutdown(): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  void shutdownDaemon();
}

async function shutdownDaemon(): Promise<void> {
  const serverClosed = closeServer();
  for (const client of clients) {
    client.destroy();
  }

  await serverClosed;
  while (sessionCompletions.size > 0) {
    await Promise.allSettled([...sessionCompletions]);
  }
  await unlink(socketPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') {
      process.stderr.write(`[sandboxd] failed to remove socket: ${error.message}\n`);
      process.exitCode = 1;
    }
  });
  process.exit();
}

function closeServer(): Promise<void> {
  if (!server.listening) {
    return Promise.resolve();
  }
  return new Promise((resolveClose) => server.close(() => resolveClose()));
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
