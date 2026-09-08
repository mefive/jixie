import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { JobSnapshot } from './definition.js';
import { runJobWorker, type JobWorkerMessage } from './worker-result.js';

const job: JobSnapshot = {
  id: 'job',
  userId: 'owner',
  kind: 'backtest',
  key: 'fixture',
  status: 'running',
  payload: {},
  error: null,
  logs: null,
  factorReportId: null,
  backtestReportId: null,
  strategyScanReportId: null,
  signalRunId: null,
  researchCuratorRunId: null,
  queuedAt: new Date(0),
  startedAt: new Date(0),
  finishedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

function fixture() {
  const worker = new EventEmitter();
  const log = vi.fn();
  const context = { job, log };
  const result = runJobWorker<number>({
    start: () => worker,
    context,
    readMessage: (message) => message as JobWorkerMessage<number>,
    exitedMessage: (code) => `exit ${code}`,
  });
  return { worker, log, result };
}

describe('job worker result bridge', () => {
  it('waits for normal exit, forwards logs, and settles once despite duplicate terminal messages', async () => {
    const { worker, log, result } = fixture();
    const settled = vi.fn();
    void result.then(settled);
    worker.emit('message', { type: 'done', payload: 42 });
    worker.emit('message', { type: 'done', payload: 99 });
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    const entry = { source: 'system', level: 'info', text: 'cleanup' };
    worker.emit('message', { type: 'log', entry });
    worker.emit('exit', 0);
    await expect(result).resolves.toBe(42);
    expect(log).toHaveBeenCalledWith(entry);
    expect(worker.listenerCount('message')).toBe(0);
  });

  it('rejects a nonzero exit even after a success message', async () => {
    const { worker, result } = fixture();
    const rejected = expect(result).rejects.toThrow('exit 1');
    worker.emit('message', { type: 'done', payload: 42 });
    worker.emit('exit', 1);
    await rejected;
  });

  it('rejects normal exit without a terminal message', async () => {
    const { worker, result } = fixture();
    const rejected = expect(result).rejects.toThrow('exit 0');
    worker.emit('exit', 0);
    await rejected;
  });

  it('reports worker error once and tolerates the following exit', async () => {
    const { worker, result } = fixture();
    const rejected = expect(result).rejects.toThrow('worker failed');
    worker.emit('error', new Error('worker failed'));
    worker.emit('exit', 1);
    await rejected;
  });

  it('converts a synchronous spawn exception into a rejected execution', async () => {
    await expect(
      runJobWorker({
        start() {
          throw new Error('spawn failed');
        },
        context: { job, log: vi.fn() },
        readMessage: () => undefined,
        exitedMessage: () => 'exit',
      }),
    ).rejects.toThrow('spawn failed');
  });
});
