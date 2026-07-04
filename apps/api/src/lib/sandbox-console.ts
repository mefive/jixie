import type { LogLevel } from '@jixie/shared';

/** Where a sandbox console line goes — the worker wires this to postMessage({source:'user', ...}). */
export type UserLogSink = (level: LogLevel, text: string) => void;

/** The subset of `console` we expose to strategy/factor code (the free `console` identifier). */
export interface SandboxConsole {
  log: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

// Format one console argument the way a dev expects: strings verbatim, objects as compact JSON
// (circular refs fall back to String), everything else via String().
function formatArg(arg: unknown): string {
  if (typeof arg === 'string') {
    return arg;
  }
  if (arg !== null && typeof arg === 'object') {
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }
  return String(arg);
}

/**
 * A `console` shim for the strategy/factor sandbox. It forwards console.log/info/warn/error to the job
 * log tagged source:'user' (level maps warn→warn, error→error, log/info→info).
 *
 * Hard line cap: `onBar` runs once per stock per day, so a stray console.log in a hot path can emit
 * hundreds of thousands of lines — that would blow up memory and the log panel. We stop forwarding at
 * `cap` and emit one truncation notice, so a runaway loop degrades to a warning instead of a crash.
 */
export function makeSandboxConsole(onUserLog: UserLogSink, cap = 2000): SandboxConsole {
  let emitted = 0;
  let capped = false;

  const emit = (level: LogLevel, args: unknown[]): void => {
    if (emitted >= cap) {
      if (!capped) {
        capped = true;
        onUserLog('warn', `用户日志超过 ${cap} 行,后续输出已省略`);
      }
      return;
    }
    emitted += 1;
    onUserLog(level, args.map(formatArg).join(' '));
  };

  return {
    log: (...args) => emit('info', args),
    info: (...args) => emit('info', args),
    warn: (...args) => emit('warn', args),
    error: (...args) => emit('error', args),
  };
}

/** No-op console for compile paths without a job (tests, codegen self-check). */
export const noopSandboxConsole: SandboxConsole = {
  log: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
