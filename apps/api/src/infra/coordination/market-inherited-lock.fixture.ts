import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { maintenanceLockDescriptor, withMaintenanceLock } from './market-access.js';

// 人为延长后代生命周期，验证父进程死亡不会提前释放共享 M。
// Keep a descendant alive deliberately to verify that parent death cannot release shared M early.
await withMaintenanceLock(async () => {
  if (process.argv[2] === 'descendant') {
    setInterval(() => {}, 1000);
    process.send?.({ pid: process.pid });
    await new Promise(() => {});
  } else {
    const child = fork(fileURLToPath(import.meta.url), ['descendant'], {
      execArgv: process.execArgv,
      env: { ...process.env, JIXIE_MAINTENANCE_LOCK_FD: '4' },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc', maintenanceLockDescriptor()],
    });
    child.once('message', (message) => process.send?.(message));
    await new Promise(() => {});
  }
});
