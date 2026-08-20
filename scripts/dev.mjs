#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');
const socketPath = join(tmpdir(), `jixie-sandboxd-dev-${process.pid}.sock`);
const children = new Map();
const environment = {
  ...process.env,
  NODE_ENV: 'development',
  JIXIE_SANDBOX_SOCKET: socketPath,
  JIXIE_SANDBOXD_MODE: 'local',
  JIXIE_PYTHON_LOCAL: '0',
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
    stdio: 'inherit',
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

async function waitForSocket(child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
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

function signalProcessGroup(child, signal) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  try {
    if (process.platform === 'win32') {
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    if (error?.code !== 'ESRCH') {
      console.error(`[dev] failed to stop process ${child.pid}: ${error.message}`);
    }
  }
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function shutdown(exitCode) {
  if (stopping) {
    return;
  }
  stopping = true;
  const gracefulSignal = exitCode === 0 ? 'SIGINT' : 'SIGTERM';
  for (const child of children.values()) {
    signalProcessGroup(child, gracefulSignal);
  }
  await Promise.all([...children.values()].map((child) => waitForExit(child, 3_000)));
  for (const child of children.values()) {
    signalProcessGroup(child, 'SIGKILL');
  }
  process.exitCode = exitCode;
  finishDevelopment();
}

process.once('SIGINT', () => void shutdown(0));
process.once('SIGTERM', () => void shutdown(0));

try {
  console.log(`[dev] starting sandboxd at ${socketPath}`);
  const sandboxd = startService('sandboxd', 'sandboxd');
  await waitForSocket(sandboxd);
  console.log('[dev] Python runtime ready; starting API and Web');
  startService('api', 'api');
  startService('web', 'web');
} catch (error) {
  console.error(`[dev] startup failed: ${error instanceof Error ? error.message : String(error)}`);
  await shutdown(1);
}

await developmentFinished;
