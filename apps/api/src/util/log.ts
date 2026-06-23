/** Minimal logging: a uniform prefix to distinguish our output from dependencies'.
 * Swap in something stronger (levels / file output) when needed. */
export function log(...args: unknown[]): void {
  console.log('[jixie]', ...args);
}

export function warn(...args: unknown[]): void {
  console.warn('[jixie]', ...args);
}

export function error(...args: unknown[]): void {
  console.error('[jixie]', ...args);
}
