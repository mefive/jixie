import { createHash } from 'node:crypto';

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * 递归稳定排序 JSON 键，供来源指纹跨对象顺序一致。
 *
 * Sort JSON keys recursively for order-independent source fingerprints.
 */
function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJsonValue(child)]),
    );
  }

  return value;
}
