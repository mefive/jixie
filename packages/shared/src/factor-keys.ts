/**
 * 限定已发布因子 key 的稳定格式。
 *
 * Restrict immutable published factor keys to their stable format.
 */
export const FACTOR_KEY_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

export function isComputedFactorKey(key: string): boolean {
  return FACTOR_KEY_PATTERN.test(key);
}
