/** 极简日志：统一前缀，方便和依赖库输出区分。需要更强能力（分级 / 落文件）再换。 */
export function log(...args: unknown[]): void {
  console.log('[jixie]', ...args);
}

export function warn(...args: unknown[]): void {
  console.warn('[jixie]', ...args);
}

export function error(...args: unknown[]): void {
  console.error('[jixie]', ...args);
}
