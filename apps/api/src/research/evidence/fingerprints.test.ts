import { describe, expect, it } from 'vitest';
import { researchPayloadHash } from './fingerprints.js';

describe('research payload hashes', () => {
  it('is stable across object ordering', () => {
    expect(researchPayloadHash({ b: 2, a: { d: 4, c: 3 } })).toBe(
      researchPayloadHash({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });

  it('changes when a payload value changes', () => {
    expect(researchPayloadHash({ value: 1 })).not.toBe(researchPayloadHash({ value: 2 }));
  });
});
