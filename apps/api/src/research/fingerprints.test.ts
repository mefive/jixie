import { describe, expect, it } from 'vitest';
import { researchProtocolById } from './catalog.js';
import {
  researchDataInputFingerprint,
  researchPayloadHash,
  researchRunFingerprints,
} from './fingerprints.js';

describe('research run fingerprints', () => {
  const protocol = researchProtocolById.get('time_series_relationship')!;
  const inputA = researchDataInputFingerprint({
    inputId: 'a',
    payload: [{ date: '20240101', value: 1 }],
    observations: 1,
    firstDate: '20240101',
    lastDate: '20240101',
  });
  const inputB = researchDataInputFingerprint({
    inputId: 'b',
    payload: [{ date: '20240101', value: 2 }],
    observations: 1,
    firstDate: '20240101',
    lastDate: '20240101',
  });

  it('is stable across object and input ordering', () => {
    expect(researchPayloadHash({ b: 2, a: { d: 4, c: 3 } })).toBe(
      researchPayloadHash({ a: { c: 3, d: 4 }, b: 2 }),
    );
    const left = researchRunFingerprints(protocol, [inputB, inputA], environment());
    const right = researchRunFingerprints(protocol, [inputA, inputB], environment());
    expect(left).toEqual(right);
  });

  it('separates implementation, data, and environment changes', () => {
    const baseline = researchRunFingerprints(protocol, [inputA], environment());
    const codeChanged = researchRunFingerprints(protocol, [inputA], {
      ...environment(),
      appRevision: 'revision-b',
    });
    const dataChanged = researchRunFingerprints(
      protocol,
      [
        researchDataInputFingerprint({
          inputId: 'a',
          payload: [{ date: '20240101', value: 3 }],
          observations: 1,
          firstDate: '20240101',
          lastDate: '20240101',
        }),
      ],
      environment(),
    );
    const environmentChanged = researchRunFingerprints(protocol, [inputA], {
      ...environment(),
      nodeVersion: 'v23.0.0',
    });

    expect(codeChanged.protocol.implementationHash).not.toBe(baseline.protocol.implementationHash);
    expect(codeChanged.data.hash).toBe(baseline.data.hash);
    expect(dataChanged.data.hash).not.toBe(baseline.data.hash);
    expect(environmentChanged.environment.hash).not.toBe(baseline.environment.hash);
  });
});

function environment() {
  return {
    appRevision: 'revision-a',
    nodeVersion: 'v22.0.0',
    platform: 'test',
    architecture: 'test',
  };
}
