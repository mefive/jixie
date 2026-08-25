const pollIntervalMs = 50;

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
