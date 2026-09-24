import { Worker } from 'node:worker_threads';
import { fork } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { runWorker } from './worker.js';

const decoder = z.discriminatedUnion('type', [
  z.object({ type: z.literal('done'), payload: z.number() }),
  z.object({ type: z.literal('error'), message: z.string() }),
  z.object({
    type: z.literal('log'),
    entry: z.object({ source: z.literal('system'), level: z.literal('info'), text: z.string() }),
  }),
]);
function thread(code: string, onLog = vi.fn()) {
  let resource!: Worker;
  const exited = vi.fn();
  const result = runWorker({
    start: () => {
      resource = new Worker(`const { parentPort } = require('node:worker_threads'); ${code}`, {
        eval: true,
      });
      resource.once('exit', exited);
      return resource;
    },
    onLog,
    readMessage: (raw) => decoder.parse(raw),
    exitedMessage: (code) => `exit ${code}`,
  });
  return { resource, result, exited, onLog };
}

describe('Worker resource ownership', () => {
  it('forwards logs, uses the first result, and waits for actual exit', async () => {
    const fixture = thread(`
      parentPort.postMessage({type:'log', entry:{source:'system',level:'info',text:'work'}});
      parentPort.postMessage({type:'done',payload:42});
      parentPort.postMessage({type:'done',payload:99});
      setTimeout(() => {}, 50);
    `);
    await expect(fixture.result).resolves.toBe(42);
    expect(fixture.exited).toHaveBeenCalledOnce();
    expect(fixture.onLog).toHaveBeenCalledWith({ source: 'system', level: 'info', text: 'work' });
    expect(fixture.resource.listenerCount('message')).toBe(0);
  });

  it.each([
    [`parentPort.postMessage({type:'done',payload:42}); process.exitCode = 1;`, 'exit 1'],
    [``, 'exit 0'],
    [
      `parentPort.postMessage({type:'error',message:'failed'}); setInterval(() => {}, 1000);`,
      'failed',
    ],
  ])('rejects unsuccessful execution and reclaims the thread', async (code, message) => {
    const fixture = thread(code);
    await expect(fixture.result).rejects.toThrow(message);
    expect(fixture.exited).toHaveBeenCalledOnce();
  });

  it('terminates a live thread on decoder failure before rejecting', async () => {
    const fixture = thread(
      `parentPort.postMessage({type:'done',payload:'invalid'}); setInterval(() => {}, 1000);`,
    );
    await expect(fixture.result).rejects.toThrow();
    expect(fixture.exited).toHaveBeenCalledOnce();
  });

  it('terminates a live thread on a throwing log callback', async () => {
    const fixture = thread(
      `parentPort.postMessage({type:'log',entry:{source:'system',level:'info',text:'work'}}); setInterval(() => {}, 1000);`,
      vi.fn(() => {
        throw new Error('log failed');
      }),
    );
    await expect(fixture.result).rejects.toThrow('log failed');
    expect(fixture.exited).toHaveBeenCalledOnce();
  });

  it('rejects synchronous startup failure', async () => {
    await expect(
      runWorker({
        start() {
          throw new Error('spawn failed');
        },
        onLog: () => {},
        readMessage: (raw) => decoder.parse(raw),
        exitedMessage: String,
      }),
    ).rejects.toThrow('spawn failed');
  });

  it('reclaims a forked child after decoder failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jixie-worker-'));
    const path = join(directory, 'child.cjs');
    await writeFile(
      path,
      `process.send({type:'done',payload:'invalid'}); setInterval(() => {},1000);`,
    );
    let resource: ReturnType<typeof fork> | undefined;
    const exited = vi.fn();
    try {
      await expect(
        runWorker({
          start() {
            resource = fork(path, [], { stdio: 'ignore' });
            resource.once('exit', exited);
            return resource;
          },
          onLog: () => {},
          readMessage: (raw) => decoder.parse(raw),
          exitedMessage: String,
        }),
      ).rejects.toThrow();
      expect(exited).toHaveBeenCalledOnce();
      expect(resource?.signalCode).toBe('SIGKILL');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('settles child spawn errors that have no exit event', async () => {
    await expect(
      runWorker({
        start: () =>
          fork('missing.cjs', [], { execPath: '/nonexistent/jixie-node', stdio: 'ignore' }),
        onLog: () => {},
        readMessage: (raw) => decoder.parse(raw),
        exitedMessage: String,
      }),
    ).rejects.toThrow();
  });
});
