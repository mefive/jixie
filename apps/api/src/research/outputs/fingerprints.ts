import { createHash } from 'node:crypto';

export function researchPayloadHash(value: unknown): string {
  const serialized = JSON.stringify(canonicalize(value)) ?? 'undefined';
  return createHash('sha256').update(serialized).digest('hex');
}

/**
 * 递归规范 JSON 键序，供内容比较与图片缓存。
 *
 * Canonicalize JSON keys recursively for content comparison and image caching.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}
