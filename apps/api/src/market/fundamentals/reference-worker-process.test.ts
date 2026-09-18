import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addReferenceSyncSummary,
  chunkReferenceCodes,
  emptyReferenceSyncSummary,
  runReferenceWorkerProcess,
} from './reference-worker-process.js';

const dependencies = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock('node:child_process', () => ({ fork: dependencies.fork }));

class Child extends EventEmitter {
  send = vi.fn((_message: unknown, callback: (error: Error | null) => void) => callback(null));
  kill = vi.fn(() => {
    queueMicrotask(() => this.emit('close', null, 'SIGTERM'));
    return true;
  });
}

let child: Child;
beforeEach(() => {
  child = new Child();
  dependencies.fork.mockReset().mockReturnValue(child);
});

const summary = { ...emptyReferenceSyncSummary(), requested: 1, processed: 1 };
const completed = { type: 'reference-worker-item', item: '20260630' };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

describe('reference worker process', () => {
  it('splits codes into bounded process batches', () => {
    expect(chunkReferenceCodes(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e'],
    ]);
  });

  it('aggregates worker summaries', () => {
    const current = {
      requested: 2,
      skipped: 0,
      processed: 2,
      changed: 1,
      created: 3,
      updated: 4,
      deleted: 5,
    };
    expect(addReferenceSyncSummary(emptyReferenceSyncSummary(), current)).toEqual(current);
  });

  it('acknowledges an item only after durable completion and waits for the child to close', async () => {
    const entered = deferred();
    const persisted = deferred();
    let settled = false;
    const result = runReferenceWorkerProcess('financials', ['20260630'], {
      onItemComplete: async () => {
        entered.resolve();
        await persisted.promise;
      },
    }).finally(() => {
      settled = true;
    });
    child.emit('message', completed);
    await entered.promise;
    expect(child.send).not.toHaveBeenCalled();
    expect(settled).toBe(false);
    persisted.resolve();
    await vi.waitFor(() =>
      expect(child.send).toHaveBeenCalledWith(
        { type: 'reference-worker-acknowledged', item: '20260630' },
        expect.any(Function),
      ),
    );
    child.emit('message', { type: 'reference-worker-summary', summary });
    child.emit('exit', 0, null);
    expect(settled).toBe(false);
    child.emit('close', 0, null);
    expect(await result).toEqual(summary);
  });

  it('kills and reaps the child when checkpoint persistence fails', async () => {
    const result = runReferenceWorkerProcess('financials', ['20260630'], {
      onItemComplete: async () => {
        throw new Error('checkpoint failed');
      },
    });
    const rejected = expect(result).rejects.toThrow('checkpoint failed');
    child.emit('message', completed);
    await rejected;
    expect(child.send).not.toHaveBeenCalled();
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('retains acknowledged progress when the child fails later', async () => {
    const persisted: string[] = [];
    const result = runReferenceWorkerProcess('financials', ['20260630', '20260930'], {
      onItemComplete: async (item) => {
        persisted.push(item);
      },
    });
    const rejected = expect(result).rejects.toThrow('code 1');
    child.emit('message', completed);
    await vi.waitFor(() => expect(child.send).toHaveBeenCalledOnce());
    child.emit('close', 1, null);
    await rejected;
    expect(persisted).toEqual(['20260630']);
  });

  it('rejects a clean exit that has a summary but omits completion acknowledgements', async () => {
    const result = runReferenceWorkerProcess('financials', ['20260630']);
    const rejected = expect(result).rejects.toThrow('without complete acknowledged results');
    child.emit('message', { type: 'reference-worker-summary', summary });
    child.emit('close', 0, null);
    await rejected;
  });

  it('rejects malformed IPC before invoking the persistence callback', async () => {
    const persist = vi.fn();
    const result = runReferenceWorkerProcess('financials', ['20260630'], {
      onItemComplete: persist,
    });
    const rejected = expect(result).rejects.toThrow('Invalid reference worker message');
    child.emit('message', { type: 'reference-worker-summary', summary: {} });
    await rejected;
    expect(persist).not.toHaveBeenCalled();
  });
});
