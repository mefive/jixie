#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { readFile, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signalProcessGroup, waitForServiceExit } from './process-group.mjs';

const projectDirectory = join(dirname(fileURLToPath(import.meta.url)), '../..');
const socketPath = join(tmpdir(), `jixie-sandboxd-dev-${process.pid}.sock`);
const pythonExecutable =
  process.env.JIXIE_PYTHON_EXECUTABLE ??
  join(projectDirectory, '.venv', 'research-py-v1', 'bin', 'python3');
const children = new Map();
const environment = {
  ...process.env,
  NODE_ENV: 'development',
  JIXIE_SANDBOX_SOCKET: socketPath,
  JIXIE_SANDBOXD_MODE: 'local',
  JIXIE_PYTHON_LOCAL: '0',
  JIXIE_PYTHON_EXECUTABLE: pythonExecutable,
};

let stopping = false;
let finishDevelopment;
const developmentFinished = new Promise((resolve) => {
  finishDevelopment = resolve;
});

function startService(name, filter) {
  const child = spawn('pnpm', ['--filter', filter, 'dev'], {
    cwd: projectDirectory,
    env: environment,
    // 终端输入由启动器保留，避免多个 CLI 的按键处理吞掉 Ctrl+C。
    // Keep terminal input with the launcher so competing CLI handlers cannot consume Ctrl+C.
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: process.platform !== 'win32',
  });
  children.set(name, child);
  child.once('error', (error) => {
    if (!stopping) {
      console.error(`[dev] ${name} failed to start: ${error.message}`);
      void shutdown(1);
    }
  });
  child.once('exit', (code, signal) => {
    if (!stopping) {
      const detail = signal ? `signal ${signal}` : `code ${code ?? 1}`;
      console.error(`[dev] ${name} exited unexpectedly (${detail})`);
      void shutdown(code && code > 0 ? code : 1);
    }
  });
  return child;
}

/**
 * 等待开发服务 socket 就绪或提前退出，避免启动器静默挂起。
 *
 * Wait for a development socket or early process failure.
 */
async function waitForSocket(child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (stopping) {
      return;
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('sandboxd exited before its socket became ready');
    }
    try {
      const metadata = await stat(socketPath);
      if (metadata.isSocket()) {
        return;
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`sandboxd did not create ${socketPath} within 10 seconds`);
}

function stopService(child, signal) {
  try {
    signalProcessGroup(child, signal);
  } catch (error) {
    console.error(`[dev] failed to stop process ${child.pid}: ${error.message}`);
  }
}

/**
 * 协调所有开发子进程组关闭并等待退出，防止遗留监听。
 *
 * Shut down development process groups and wait for exit to avoid stale listeners.
 */
async function shutdown(exitCode) {
  if (stopping) {
    return;
  }
  stopping = true;
  console.log('[dev] stopping services...');

  const gracefulSignal = exitCode === 0 ? 'SIGINT' : 'SIGTERM';
  for (const child of children.values()) {
    stopService(child, gracefulSignal);
  }
  await Promise.all([...children.values()].map((child) => waitForServiceExit(child, 3_000)));
  for (const child of children.values()) {
    stopService(child, 'SIGKILL');
  }
  await Promise.all([...children.values()].map((child) => waitForServiceExit(child, 1_000)));
  await unlink(socketPath).catch((error) => {
    if (error?.code !== 'ENOENT') {
      console.error(`[dev] failed to remove socket ${socketPath}: ${error.message}`);
    }
  });
  process.exitCode = exitCode;
  console.log('[dev] services stopped');
  finishDevelopment();
}

// 清理期间重复按 Ctrl+C 仍保留处理器，避免启动器先退出并遗留独立子进程组。
// Retain handlers during cleanup so repeated Ctrl+C cannot orphan detached service groups.
process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

try {
  await verifyResearchPythonRuntime();
  if (!stopping) {
    console.log(`[dev] starting sandboxd at ${socketPath}`);
    const sandboxd = startService('sandboxd', 'sandboxd');
    await waitForSocket(sandboxd);

    if (!stopping) {
      console.log('[dev] Python runtime ready; starting API and Web');
      startService('api', 'api');
      startService('web', 'web');
    }
  }
} catch (error) {
  if (!stopping) {
    console.error(
      `[dev] startup failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    await shutdown(1);
  }
}

await developmentFinished;

/**
 * 启动开发服务前校验固定 CPython 与研究包精确版本，不静默退回系统环境。
 *
 * Verify pinned CPython and research package versions before starting development services.
 */
async function verifyResearchPythonRuntime() {
  const requirementsPath = join(
    projectDirectory,
    'apps',
    'sandboxd',
    'python',
    'requirements-research-runtime.txt',
  );
  const requirements = Object.fromEntries(
    (await readFile(requirementsPath, 'utf8'))
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => line.split('==')),
  );
  const importNames = {
    numpy: 'numpy',
    pandas: 'pandas',
    scipy: 'scipy',
    statsmodels: 'statsmodels',
    matplotlib: 'matplotlib',
    'scikit-learn': 'sklearn',
  };
  const validationScript = [
    'import sys',
    'from importlib import import_module',
    'from importlib.metadata import version',
    'if sys.version_info[:2] != (3, 13):',
    '    raise RuntimeError(f"CPython {sys.version_info.major}.{sys.version_info.minor}; expected 3.13")',
    `requirements = ${JSON.stringify(requirements)}`,
    `imports = ${JSON.stringify(importNames)}`,
    'for distribution, expected in requirements.items():',
    '    import_module(imports[distribution])',
    '    actual = version(distribution)',
    '    if actual != expected:',
    '        raise RuntimeError(f"{distribution}=={actual}; expected {expected}")',
  ].join('\n');

  if (stopping) {
    return;
  }

  await new Promise((resolveReady, rejectReady) => {
    const child = spawn(pythonExecutable, ['-I', '-c', validationScript], {
      cwd: projectDirectory,
      env: process.env,
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: process.platform !== 'win32',
    });
    children.set('python verification', child);

    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4_000);
    });
    child.once('error', () => {
      rejectReady(
        new Error(
          `research-py-v1 is not installed at ${pythonExecutable}. Run pnpm setup:sandbox.`,
        ),
      );
    });
    child.once('exit', (code) => {
      if (code === 0) {
        console.log(`[dev] verified research-py-v1 packages at ${pythonExecutable}`);
        resolveReady();
        return;
      }
      rejectReady(
        new Error(
          `research-py-v1 package verification failed at ${pythonExecutable}: ${stderr.trim() || `exit code ${code ?? 1}`}. Run pnpm setup:sandbox.`,
        ),
      );
    });
  });
}
