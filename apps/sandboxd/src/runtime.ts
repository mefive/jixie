import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CONTAINER_ID_WAIT_MS = 2_000;
const CLEANUP_COMMAND_TIMEOUT_MS = 5_000;
const CHILD_EXIT_WAIT_MS = 1_000;

export type SandboxMode = 'local' | 'docker' | 'podman';
export type RuntimeStopReason = 'graceful' | 'force' | 'exited';

export interface SandboxRuntime {
  child: ChildProcessWithoutNullStreams;
  stop(reason: RuntimeStopReason): Promise<void>;
}

export interface SpawnSandboxRuntimeOptions {
  mode: string;
  nodeEnvironment?: string;
  runtimeImage: string;
  runnerPath: string;
  pythonExecutable: string;
  codeTimeoutSeconds: number;
  sessionTimeoutMs: number;
  gracefulStopMs: number;
  onWarning?: (message: string) => void;
}

export async function spawnSandboxRuntime(
  options: SpawnSandboxRuntimeOptions,
): Promise<SandboxRuntime> {
  switch (options.mode) {
    case 'local':
      if (options.nodeEnvironment === 'production') {
        throw new Error('local sandbox mode is forbidden in production');
      }
      return localRuntime(options);
    case 'docker':
      if (options.nodeEnvironment === 'production') {
        throw new Error('Docker sandbox mode is for local verification only');
      }
      return containerRuntime('docker', options);
    case 'podman':
      return containerRuntime('podman', options);
    default:
      throw new Error(`unknown JIXIE_SANDBOXD_MODE: ${options.mode}`);
  }
}

function localRuntime(options: SpawnSandboxRuntimeOptions): SandboxRuntime {
  const child = spawn(options.pythonExecutable, ['-I', '-u', options.runnerPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.on('error', () => {});
  child.stdin.on('error', () => {});
  let stopPromise: Promise<void> | undefined;

  return {
    child,
    stop(reason) {
      stopPromise ??= stopLocalRuntime(child, reason, options.gracefulStopMs);
      return stopPromise;
    },
  };
}

async function containerRuntime(
  executable: Extract<SandboxMode, 'docker' | 'podman'>,
  options: SpawnSandboxRuntimeOptions,
): Promise<SandboxRuntime> {
  const stateDirectory = await mkdtemp(join(tmpdir(), 'jixie-sandbox-runtime-'));
  const containerIdPath = join(stateDirectory, 'container.cid');
  const args = containerRunArgs(executable, options, containerIdPath);
  const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  child.on('error', () => {});
  child.stdin.on('error', () => {});
  let stopPromise: Promise<void> | undefined;

  return {
    child,
    stop(reason) {
      stopPromise ??= stopContainerRuntime({
        child,
        executable,
        containerIdPath,
        stateDirectory,
        reason,
        gracefulStopMs: options.gracefulStopMs,
        onWarning: options.onWarning,
      });
      return stopPromise;
    },
  };
}

function containerRunArgs(
  executable: Extract<SandboxMode, 'docker' | 'podman'>,
  options: SpawnSandboxRuntimeOptions,
  containerIdPath: string,
): string[] {
  return [
    'run',
    '--rm',
    '--interactive',
    '--pull=never',
    `--cidfile=${containerIdPath}`,
    '--network=none',
    '--read-only',
    '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=64m',
    executable === 'docker' ? '--cap-drop=ALL' : '--cap-drop=all',
    executable === 'docker'
      ? '--security-opt=no-new-privileges=true'
      : '--security-opt=no-new-privileges',
    '--pids-limit=64',
    '--memory=768m',
    '--memory-swap=1024m',
    '--cpus=1',
    ...(executable === 'podman'
      ? [`--timeout=${Math.ceil(options.sessionTimeoutMs / 1_000)}`]
      : []),
    '--user=65532:65532',
    `--env=JIXIE_PYTHON_CODE_TIMEOUT_SECONDS=${options.codeTimeoutSeconds}`,
    options.runtimeImage,
  ];
}

async function stopLocalRuntime(
  child: ChildProcessWithoutNullStreams,
  reason: RuntimeStopReason,
  gracefulStopMs: number,
): Promise<void> {
  if (reason !== 'exited') {
    child.stdin.end();
  }
  if (reason === 'graceful') {
    await waitForChildExit(child, gracefulStopMs);
  }
  if (!childHasExited(child)) {
    child.kill('SIGKILL');
    await waitForChildExit(child, CHILD_EXIT_WAIT_MS);
  }
}

async function stopContainerRuntime(args: {
  child: ChildProcessWithoutNullStreams;
  executable: Extract<SandboxMode, 'docker' | 'podman'>;
  containerIdPath: string;
  stateDirectory: string;
  reason: RuntimeStopReason;
  gracefulStopMs: number;
  onWarning?: (message: string) => void;
}): Promise<void> {
  try {
    if (args.reason !== 'exited') {
      args.child.stdin.end();
    }
    if (args.reason === 'graceful') {
      await waitForChildExit(args.child, args.gracefulStopMs);
    }

    const cleanExit = args.child.exitCode === 0 && args.child.signalCode === null;
    if (!cleanExit) {
      const containerId = await waitForContainerId(args.containerIdPath, args.child);
      if (containerId) {
        await runCleanupCommand(args.executable, ['kill', containerId]);
        await runCleanupCommand(args.executable, ['rm', '--force', containerId]);
      } else if (args.reason !== 'exited') {
        args.onWarning?.(
          `could not resolve container id from ${args.containerIdPath}; terminating the attached ${args.executable} client`,
        );
      }
    }

    if (!childHasExited(args.child)) {
      args.child.kill('SIGKILL');
      await waitForChildExit(args.child, CHILD_EXIT_WAIT_MS);
    }
  } finally {
    await rm(args.stateDirectory, { recursive: true, force: true }).catch((error: Error) => {
      args.onWarning?.(`failed to remove ${args.stateDirectory}: ${error.message}`);
    });
  }
}

async function waitForContainerId(
  containerIdPath: string,
  child: ChildProcessWithoutNullStreams,
): Promise<string | null> {
  const deadline = Date.now() + CONTAINER_ID_WAIT_MS;
  while (Date.now() < deadline) {
    const containerId = await readFile(containerIdPath, 'utf8')
      .then((value) => value.trim())
      .catch(() => '');
    if (containerId) {
      return containerId;
    }
    if (childHasExited(child)) {
      return null;
    }
    await delay(25);
  }
  return null;
}

function runCleanupCommand(executable: string, args: string[]): Promise<void> {
  return new Promise((resolveCommand) => {
    const command = spawn(executable, args, { stdio: 'ignore' });
    const timeout = setTimeout(() => command.kill('SIGKILL'), CLEANUP_COMMAND_TIMEOUT_MS);
    timeout.unref();
    command.once('error', () => {
      clearTimeout(timeout);
      resolveCommand();
    });
    command.once('close', () => {
      clearTimeout(timeout);
      resolveCommand();
    });
  });
}

function waitForChildExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<boolean> {
  if (childHasExited(child)) {
    return Promise.resolve(true);
  }
  return new Promise((resolveExit) => {
    const timeout = setTimeout(() => {
      child.off('close', handleClose);
      resolveExit(false);
    }, timeoutMs);
    const handleClose = () => {
      clearTimeout(timeout);
      resolveExit(true);
    };
    child.once('close', handleClose);
  });
}

function childHasExited(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
