import type { EventEmitter } from 'node:events';
import type { LogLine } from '@jixie/shared';
import type { JobExecutionContext } from './definition.js';

export type JobWorkerMessage<Output> =
  | { type: 'log'; entry: LogLine }
  | { type: 'done'; payload: Output }
  | { type: 'error'; message?: string };

// Settle once, after normal exit; never run asynchronous database work in event callbacks.
export function runJobWorker<Output>(options: {
  start(): EventEmitter;
  context: JobExecutionContext;
  readMessage(message: unknown): JobWorkerMessage<Output> | undefined;
  exitedMessage(code: number | null): string;
}): Promise<Output> {
  return new Promise((resolve, reject) => {
    const worker = options.start();
    let terminal: Exclude<JobWorkerMessage<Output>, { type: 'log' }> | undefined;
    let settled = false;
    const fail = (error: Error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };
    const onMessage = (raw: unknown) => {
      if (settled) {
        return;
      }
      try {
        const message = options.readMessage(raw);
        switch (message?.type) {
          case 'log':
            options.context.log(message.entry);
            break;
          case 'done':
          case 'error':
            terminal ??= message;
            break;
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    };
    worker.on('message', onMessage);
    worker.on('error', fail);
    worker.once('exit', (code: number | null) => {
      worker.removeListener('message', onMessage);
      worker.removeListener('error', fail);
      if (settled) {
        return;
      }
      if (code !== 0 || !terminal) {
        fail(new Error(options.exitedMessage(code)));
      } else if (terminal.type === 'error') {
        fail(new Error(terminal.message ?? options.exitedMessage(code)));
      } else {
        settled = true;
        resolve(terminal.payload);
      }
    });
  });
}
