import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CONTAINER_ID_WAIT_MS = 2_000;
const CLEANUP_COMMAND_TIMEOUT_MS = 5_000;
const CHILD_EXIT_WAIT_MS = 1_000;
const CLEANUP_RETRY_DELAYS_MS = [0, 100, 250] as const;
const MANAGED_LABEL = 'io.jixie.sandboxd.managed=true';
const OWNER_LABEL_KEY = 'io.jixie.sandboxd.owner';
const MAX_COMMAND_OUTPUT_CHARACTERS = 16_000;

/**
 * 区分本地进程与容器沙盒模式，供运行时创建和回收分派。
 *
 * Select local-process or container sandbox execution and cleanup.
 */
export type SandboxMode = 'local' | 'docker' | 'podman';

/**
 * 记录运行时停止原因，供取消、超时与故障诊断。
 *
 * Classify runtime stop reasons for cancellation, timeouts and diagnostics.
 */
export type RuntimeStopReason = 'graceful' | 'force' | 'exited';

/**
 * 约束沙盒子运行时的通信与停止能力，供会话桥接统一管理。
 *
 * Expose communication and stop capabilities for a managed child sandbox runtime.
 */
export interface SandboxRuntime {
  child: ChildProcessWithoutNullStreams;
  stop(reason: RuntimeStopReason): Promise<void>;
}

/**
 * 配置子运行时的语言、资源限制及连接参数。
 *
 * Configure a child runtime's language, resource limits and connection parameters.
 */
export interface SpawnSandboxRuntimeOptions {
  mode: string;
  nodeEnvironment?: string;
  runtimeImage: string;
  runnerPath: string;
  pythonExecutable: string;
  codeTimeoutSeconds: number;
  sessionTimeoutMs: number;
  gracefulStopMs: number;
  ownerId: string;
  onWarning?: (message: string) => void;
}

/**
 * 限定遗留运行时清理范围，避免回收其他活跃实例。
 *
 * Scope stale-runtime cleanup so active instances remain protected.
 */
export interface CleanupStaleSandboxRuntimesOptions {
  mode: string;
  nodeEnvironment?: string;
  ownerId: string;
  onWarning?: (message: string) => void;
}

/**
 * 保存容器管理命令的退出码与输出，供运行时错误处理。
 *
 * Collect container-management command status and output for diagnostics.
 */
interface RuntimeCommandResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error?: string;
  timedOut: boolean;
}

/**
 * 按配置启动本地或容器运行时，并返回统一的通信和停止接口。
 *
 * Spawn a local or container runtime and return uniform communication and stop capabilities.
 */
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

/**
 * 识别并回收本应用遗留的沙盒运行时，供服务启动恢复。
 *
 * Find and clean up stale application sandbox runtimes during service recovery.
 */
export async function cleanupStaleSandboxRuntimes(
  options: CleanupStaleSandboxRuntimesOptions,
): Promise<void> {
  const executable = containerExecutable(options.mode, options.nodeEnvironment);
  if (!executable) {
    return;
  }

  const listResult = await runRuntimeCommand(executable, [
    'ps',
    '--all',
    '--quiet',
    '--filter',
    `label=${MANAGED_LABEL}`,
    '--filter',
    `label=${OWNER_LABEL_KEY}=${options.ownerId}`,
  ]);
  if (!commandSucceeded(listResult)) {
    throw new Error(`failed to list stale ${executable} sandboxes: ${commandFailure(listResult)}`);
  }

  const containerIds = [...new Set(listResult.stdout.split(/\s+/).filter(Boolean))];
  for (const containerId of containerIds) {
    await removeContainer(executable, containerId, options.onWarning);
  }
  if (containerIds.length > 0) {
    options.onWarning?.(
      `removed ${containerIds.length} stale ${executable} sandbox container(s) during startup`,
    );
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

/**
 * 创建容器沙盒并接入标准输入输出、退出及停止控制。
 *
 * Create a container sandbox and attach streams, exit handling and stop controls.
 */
async function containerRuntime(
  executable: Extract<SandboxMode, 'docker' | 'podman'>,
  options: SpawnSandboxRuntimeOptions,
): Promise<SandboxRuntime> {
  const stateDirectory = await mkdtemp(join(tmpdir(), 'jixie-sandbox-runtime-'));
  const containerIdPath = join(stateDirectory, 'container.cid');
  const containerName = `jixie-sandbox-${options.ownerId.slice(0, 12)}-${randomUUID()}`;
  const args = containerRunArgs(executable, options, containerIdPath, containerName);
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
        containerName,
        stateDirectory,
        reason,
        gracefulStopMs: options.gracefulStopMs,
        onWarning: options.onWarning,
      });
      return stopPromise;
    },
  };
}

/**
 * 根据沙盒配置生成容器参数，包含资源限制与所需挂载。
 *
 * Build container arguments from sandbox configuration, limits and required mounts.
 */
function containerRunArgs(
  executable: Extract<SandboxMode, 'docker' | 'podman'>,
  options: SpawnSandboxRuntimeOptions,
  containerIdPath: string,
  containerName: string,
): string[] {
  return [
    'run',
    '--rm',
    '--interactive',
    '--pull=never',
    `--cidfile=${containerIdPath}`,
    `--name=${containerName}`,
    `--label=${MANAGED_LABEL}`,
    `--label=${OWNER_LABEL_KEY}=${options.ownerId}`,
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

/**
 * 终止本地子进程并等待退出，避免遗留执行进程。
 *
 * Stop a local child runtime and wait for its exit.
 */
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

/**
 * 停止并移除对应容器，确保超时或取消后释放资源。
 *
 * Stop and remove a container runtime after completion, timeout or cancellation.
 */
async function stopContainerRuntime(args: {
  child: ChildProcessWithoutNullStreams;
  executable: Extract<SandboxMode, 'docker' | 'podman'>;
  containerIdPath: string;
  containerName: string;
  stateDirectory: string;
  reason: RuntimeStopReason;
  gracefulStopMs: number;
  onWarning?: (message: string) => void;
}): Promise<void> {
  try {
    let cleanupError: unknown;
    if (args.reason !== 'exited') {
      args.child.stdin.end();
    }
    if (args.reason === 'graceful') {
      await waitForChildExit(args.child, args.gracefulStopMs);
    }

    const containerId = await waitForContainerId(args.containerIdPath, args.child);
    try {
      await removeContainer(args.executable, containerId ?? args.containerName, args.onWarning);
    } catch (error) {
      cleanupError = error;
    }

    if (!childHasExited(args.child)) {
      args.child.kill('SIGKILL');
      await waitForChildExit(args.child, CHILD_EXIT_WAIT_MS);
    }
    if (cleanupError) {
      throw cleanupError;
    }
  } finally {
    await rm(args.stateDirectory, { recursive: true, force: true }).catch((error: Error) => {
      args.onWarning?.(`failed to remove ${args.stateDirectory}: ${error.message}`);
    });
  }
}

/**
 * 等待容器身份可用，再进行状态检查或清理。
 *
 * Wait for a container identity before inspecting or cleaning up its runtime.
 */
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

/**
 * 移除指定容器并处理已退出或不存在的清理边界。
 *
 * Remove a container while handling already-exited or missing instances.
 */
async function removeContainer(
  executable: Extract<SandboxMode, 'docker' | 'podman'>,
  containerId: string,
  onWarning?: (message: string) => void,
): Promise<void> {
  const initialStatus = await inspectContainer(executable, containerId);
  if (initialStatus === 'absent') {
    return;
  }
  if (initialStatus === 'unknown') {
    onWarning?.(`could not inspect ${executable} sandbox ${containerId}; attempting removal`);
  }

  const killResult = await runRuntimeCommand(executable, ['kill', containerId]);
  if (!commandSucceeded(killResult) && !commandReportsMissingContainer(killResult)) {
    onWarning?.(
      `${executable} kill failed for sandbox ${containerId}: ${commandFailure(killResult)}`,
    );
  }

  let lastRemoveResult: RuntimeCommandResult | undefined;
  let lastInspectStatus: ContainerStatus = initialStatus;
  for (const retryDelayMs of CLEANUP_RETRY_DELAYS_MS) {
    if (retryDelayMs > 0) {
      await delay(retryDelayMs);
    }
    lastRemoveResult = await runRuntimeCommand(executable, ['rm', '--force', containerId]);
    lastInspectStatus = await inspectContainer(executable, containerId);
    if (lastInspectStatus === 'absent') {
      return;
    }
  }

  throw new Error(
    `failed to verify removal of ${executable} sandbox ${containerId}; ` +
      `last rm: ${lastRemoveResult ? commandFailure(lastRemoveResult) : 'not attempted'}; ` +
      `inspect status: ${lastInspectStatus}`,
  );
}

/**
 * 描述容器当前状态，供停止与遗留实例回收判断。
 *
 * Describe container state used by stop and stale-instance cleanup.
 */
type ContainerStatus = 'present' | 'absent' | 'unknown';

async function inspectContainer(
  executable: Extract<SandboxMode, 'docker' | 'podman'>,
  containerId: string,
): Promise<ContainerStatus> {
  const result = await runRuntimeCommand(executable, ['inspect', containerId]);
  if (commandSucceeded(result)) {
    return 'present';
  }
  return commandReportsMissingContainer(result) ? 'absent' : 'unknown';
}

/**
 * 执行受控运行时管理命令并收集退出状态和诊断输出。
 *
 * Run a controlled runtime-management command and collect status and diagnostics.
 */
function runRuntimeCommand(executable: string, args: string[]): Promise<RuntimeCommandResult> {
  return new Promise((resolveCommand) => {
    const command = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;

    command.stdout.setEncoding('utf8');
    command.stderr.setEncoding('utf8');
    command.stdout.on('data', (chunk: string) => {
      stdout = `${stdout}${chunk}`.slice(-MAX_COMMAND_OUTPUT_CHARACTERS);
    });
    command.stderr.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-MAX_COMMAND_OUTPUT_CHARACTERS);
    });

    const finish = (result: RuntimeCommandResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolveCommand(result);
    };
    const timeout = setTimeout(() => {
      command.kill('SIGKILL');
      finish({
        exitCode: null,
        signal: 'SIGKILL',
        stdout,
        stderr,
        timedOut: true,
      });
    }, CLEANUP_COMMAND_TIMEOUT_MS);
    timeout.unref();

    command.once('error', (error) => {
      finish({
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        error: error.message,
        timedOut: false,
      });
    });
    command.once('close', (exitCode, signal) => {
      finish({ exitCode, signal, stdout, stderr, timedOut: false });
    });
  });
}

function commandSucceeded(result: RuntimeCommandResult): boolean {
  return result.exitCode === 0 && result.signal === null && !result.error && !result.timedOut;
}

function commandReportsMissingContainer(result: RuntimeCommandResult): boolean {
  return /no such (?:object|container)|container .* not found|does not exist/i.test(
    `${result.stderr}\n${result.stdout}`,
  );
}

/**
 * 将容器管理命令失败整理为可诊断错误。
 *
 * Convert a failed runtime-management command into a diagnostic error.
 */
function commandFailure(result: RuntimeCommandResult): string {
  if (result.timedOut) {
    return `timed out after ${CLEANUP_COMMAND_TIMEOUT_MS}ms`;
  }
  if (result.error) {
    return result.error;
  }
  const detail = result.stderr.trim() || result.stdout.trim();
  return `${result.signal ?? `exit code ${result.exitCode}`}${detail ? `: ${detail}` : ''}`;
}

/**
 * 解析容器执行程序配置，供启动和清理命令共用。
 *
 * Resolve the configured container executable for startup and cleanup commands.
 */
function containerExecutable(
  mode: string,
  nodeEnvironment?: string,
): Extract<SandboxMode, 'docker' | 'podman'> | null {
  switch (mode) {
    case 'local':
      if (nodeEnvironment === 'production') {
        throw new Error('local sandbox mode is forbidden in production');
      }
      return null;
    case 'docker':
      if (nodeEnvironment === 'production') {
        throw new Error('Docker sandbox mode is for local verification only');
      }
      return 'docker';
    case 'podman':
      return 'podman';
    default:
      throw new Error(`unknown JIXIE_SANDBOXD_MODE: ${mode}`);
  }
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
