import { runFactor } from './runner.js';
import type { FactorRunnerCommandHandler, FactorRunnerHost } from './runner.js';
import { SandboxLogBuffer } from '#infra/runtime/log-buffer.js';

interface HostFunction {
  applySync(receiver: undefined, args: string[]): string;
}
declare const __hostEmit: HostFunction;

const logs = new SandboxLogBuffer((json) => {
  __hostEmit.applySync(undefined, [json]);
});
const format = (args: unknown[]) =>
  args.map((value) => (typeof value === 'string' ? value : JSON.stringify(value))).join(' ');
const log = (level: 'info' | 'warning' | 'error', args: unknown[]) => {
  logs.append(level, format(args));
};

globalThis.console = {
  log: (...args: unknown[]) => log('info', args),
  info: (...args: unknown[]) => log('info', args),
  warn: (...args: unknown[]) => log('warning', args),
  error: (...args: unknown[]) => log('error', args),
} as Console;

let receiveCommand: FactorRunnerCommandHandler = (frame) => {
  if (frame.type !== 'factor_start') {
    throw new Error('Unsupported Factor command');
  }

  return runFactor(frame, host);
};

const host: FactorRunnerHost = {
  receive: (handler) => {
    receiveCommand = handler;
  },
};

(globalThis as Record<string, unknown>).__receiveCommand = (json: string) => {
  let result: string;
  try {
    result = receiveCommand(JSON.parse(json));
  } catch (error) {
    try {
      logs.flush();
    } catch {
      // Best-effort log delivery must not replace the original execution failure.
    }
    throw error;
  }

  logs.flush();

  return result;
};
