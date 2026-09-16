import { describe, expect, it } from 'vitest';
import { canonicalJson } from './fingerprint.js';

describe('factor source fingerprint', () => {
  it('canonicalizes object keys recursively', () => {
    expect(canonicalJson({ z: 1, nested: { b: 2, a: 1 }, a: 0 })).toBe(
      '{"a":0,"nested":{"a":1,"b":2},"z":1}',
    );
  });
});
