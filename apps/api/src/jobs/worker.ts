import type { Worker } from 'node:worker_threads';
import type { ChildProcess } from 'node:child_process';
import type { WorkerLogMessage, WorkerErrorMessage } from './worker-protocol.js';
import type { LogWriter } from './logs.js';

export type WorkerMessage<Result> =
  | WorkerLogMessage
  | { type: 'done'; payload: Result }
  | WorkerErrorMessage;

type WorkerRunOptions<Result> = {
  start(): Worker | ChildProcess;
  onLog: LogWriter;
  readMessage(message: unknown): WorkerMessage<Result> | undefined;
  exitedMessage(code: number | null): string;
};

export function runWorker<Result>(options: WorkerRunOptions<Result>): Promise<Result> {
  return new WorkerRun(options).run();
}

/** Owns one resource and its event handlers until actual exit. */
class WorkerRun<Result> {
  private resource!: Worker | ChildProcess;
  private terminal: Exclude<WorkerMessage<Result>, { type: 'log' }> | undefined;
  private failure: Error | undefined;
  private exited = false;
  private resolve!: (result: Result) => void;
  private reject!: (error: Error) => void;

  constructor(private readonly options: WorkerRunOptions<Result>) {}

  run(): Promise<Result> {
    return new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      this.resource = this.options.start();
      this.resource.on('message', this.onMessage);
      this.resource.on('error', this.onError);
      this.resource.once('exit', this.onExit);
      if (!('terminate' in this.resource)) {
        this.resource.once('close', this.onClose);
      }
    });
  }

  private cleanup(): void {
    this.resource.removeListener('message', this.onMessage);
    this.resource.removeListener('error', this.onError);
    this.resource.removeListener('exit', this.onExit);
    this.resource.removeListener('close', this.onClose);
  }

  private stop(error: unknown): void {
    this.failure ??= error instanceof Error ? error : new Error(String(error));
    if ('terminate' in this.resource) {
      void this.resource.terminate().catch((terminationError: unknown) => {
        this.failure = new AggregateError(
          [this.failure, terminationError],
          'Worker termination failed',
        );
      });
    } else if (
      this.resource.pid !== undefined &&
      this.resource.exitCode === null &&
      this.resource.signalCode === null
    ) {
      this.resource.kill('SIGKILL');
    }
  }

  // Stable callbacks retain this instance and can be removed during cleanup.
  private readonly onMessage = (raw: unknown): void => {
    if (this.failure || this.exited) {
      return;
    }
    try {
      const message = this.options.readMessage(raw);
      switch (message?.type) {
        case 'log':
          this.options.onLog(message.entry);
          break;
        case 'done':
        case 'error':
          this.terminal ??= message;
          if (this.terminal.type === 'error') {
            this.stop(new Error(this.terminal.message));
          }
          break;
      }
    } catch (error) {
      this.stop(error);
    }
  };

  private readonly onError = (error: Error): void => {
    this.stop(error);
  };

  private readonly onExit = (code: number | null): void => {
    this.exited = true;
    this.cleanup();
    if (this.failure) {
      this.reject(this.failure);
    } else if (code !== 0 || !this.terminal || this.terminal.type !== 'done') {
      this.reject(new Error(this.options.exitedMessage(code)));
    } else {
      this.resolve(this.terminal.payload);
    }
  };

  private readonly onClose = (code: number | null): void => {
    // A failed child-process spawn emits error and close, but no exit.
    if (!this.exited) {
      this.onExit(code);
    }
  };
}
