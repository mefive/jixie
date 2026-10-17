const pollIntervalMs = 50;

/**
 * 向整个子进程组发送信号，并处理进程已退出的边界。
 * Signal an entire child process group and handle already-exited processes.
 */
export function signalProcessGroup(child, signal) {
  if (!child.pid) {
    return false;
  }

  if (process.platform === 'win32') {
    if (child.exitCode !== null || child.signalCode !== null) {
      return false;
    }
    return child.kill(signal);
  }

  try {
    process.kill(-child.pid, signal);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') {
      return false;
    }
    throw error;
  }
}

/**
 * 检测子进程组是否仍存活，供有界退出等待。
 * Check whether a child process group remains alive during bounded shutdown.
 */
export function processGroupIsRunning(child) {
  if (!child.pid) {
    return false;
  }

  if (process.platform === 'win32') {
    return child.exitCode === null && child.signalCode === null;
  }

  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') {
      return false;
    }
    if (error?.code === 'EPERM') {
      return true;
    }
    throw error;
  }
}

export async function waitForServiceExit(child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (processGroupIsRunning(child) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return !processGroupIsRunning(child);
}
