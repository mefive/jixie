import { DEFAULT_LOCALE, type Locale, type LogLevel } from '@jixie/shared';
import { t } from '#i18n/messages.js';

/**
 * 定义沙盒用户日志的接收边界，Worker 可将其转为带来源标签的消息。
 * Where a sandbox console line goes — the worker wires this to postMessage({source:'user', ...}).
 */
export type UserLogSink = (level: LogLevel, text: string) => void;

/**
 * 限定提供给作者代码的 console 方法集合。
 * The subset of `console` we expose to strategy/factor code (the free `console` identifier).
 */
export interface SandboxConsole {
  log: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

// Format one console argument the way a dev expects: strings verbatim, objects as compact JSON
// (circular refs fall back to String), everything else via String().

/**
 * 将沙盒日志参数安全转换为文本，供有界日志缓冲使用。
 * Format sandbox console arguments as text for bounded log collection.
 */
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
 * 将作者 console 调用映射为带用户来源和级别的任务日志。
 * A `console` shim for the strategy/factor sandbox. It forwards console.log/info/warn/error to the job
 * log tagged source:'user' (level maps warn→warn, error→error, log/info→info).
 *
 * Hard line cap: `onBar` runs once per stock per day, so a stray console.log in a hot path can emit
 * hundreds of thousands of lines — that would blow up memory and the log panel. We stop forwarding at
 * `cap` and emit one truncation notice, so a runaway loop degrades to a warning instead of a crash.
 */
export function makeSandboxConsole(
  onUserLog: UserLogSink,
  cap = 2000,
  locale: Locale = DEFAULT_LOCALE,
): SandboxConsole {
  let emitted = 0;
  let capped = false;

  const emit = (level: LogLevel, args: unknown[]): void => {
    if (emitted >= cap) {
      if (!capped) {
        capped = true;
        onUserLog('warn', t(locale, 'userLogCapped', { cap }));
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
