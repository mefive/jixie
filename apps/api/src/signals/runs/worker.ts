import type { SignalWorkerMessage } from './worker-protocol.js';
import { prisma, withDatabase, closeDatabase } from '#infra/database/prisma.js';
import type { LogLevel, LogLine } from '@jixie/shared';
import { runSignal } from './compute.js';

const runId = process.argv[2];
if (!runId || !process.send) {
  throw new Error('signal-worker must be spawned as an IPC child process with a run id');
}

// 宿主丢失时立即退出，禁止留下失去 owner 的计算子进程。
// Exit when the host disconnects rather than leaving an ownerless computation behind.
const onHostDisconnected = () => process.exit(1);
process.once('disconnect', onHostDisconnected);

const send = (message: SignalWorkerMessage) => process.send?.(message);
const emit = (entry: LogLine) => send({ type: 'log', entry });
const systemLog = (text: string) => emit({ source: 'system', level: 'info', text });
const userLog = (level: LogLevel, text: string) => emit({ source: 'user', level, text });

await withDatabase(prisma, async () => {
  try {
    const output = await runSignal(runId, systemLog, userLog);
    send({ type: 'done', output });
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  } finally {
    await closeDatabase(prisma);
    process.removeListener('disconnect', onHostDisconnected);
    process.disconnect();
  }
});
