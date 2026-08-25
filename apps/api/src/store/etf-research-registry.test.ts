import { describe, expect, it } from 'vitest';
import {
  ETF_RESEARCH_CODES,
  ETF_RESEARCH_REGISTRY,
  ETF_RESEARCH_REGISTRY_VERSION,
  etfResearchMembership,
  validateEtfResearchRegistry,
  type EtfResearchRegistryEntry,
} from './etf-research-registry.js';

describe('ETF research registry', () => {
  it('freezes a validated representative product set within the planned boundary', () => {
    expect(() => validateEtfResearchRegistry()).not.toThrow();
    expect(ETF_RESEARCH_REGISTRY.length).toBeGreaterThanOrEqual(60);
    expect(ETF_RESEARCH_CODES.length).toBeGreaterThanOrEqual(60);
    expect(ETF_RESEARCH_CODES.length).toBeLessThanOrEqual(100);
    expect(new Set(ETF_RESEARCH_CODES).size).toBe(ETF_RESEARCH_CODES.length);
  });

  it('keeps the original major ETF lane inside registry v1', () => {
    const originalCodes = [
      '510050.SH',
      '510300.SH',
      '563360.SH',
      '510500.SH',
      '512100.SH',
      '563300.SH',
      '159915.SZ',
      '588000.SH',
      '510880.SH',
      '518880.SH',
      '513100.SH',
      '159920.SZ',
      '513500.SH',
      '511010.SH',
      '511260.SH',
      '511090.SH',
      '159985.SZ',
      '159980.SZ',
      '159981.SZ',
    ];

    expect(originalCodes.every((code) => ETF_RESEARCH_CODES.includes(code))).toBe(true);
  });

  it('returns stable exposure and role metadata by product code', () => {
    expect(etfResearchMembership('510300.SH')).toMatchObject({
      registryVersion: ETF_RESEARCH_REGISTRY_VERSION,
      exposureId: 'cn.csi_300',
      role: 'primary',
      benchmarkCode: '000300.SH',
    });
    expect(etfResearchMembership('159919.SZ')).toMatchObject({
      exposureId: 'cn.csi_300',
      role: 'backup',
    });
    expect(etfResearchMembership('000001.SZ')).toBeNull();
  });

  it('rejects duplicate product assignments', () => {
    const first = ETF_RESEARCH_REGISTRY[0];
    const duplicate: EtfResearchRegistryEntry = {
      ...first,
      exposureId: 'cn.duplicate',
      primaryTsCode: first.primaryTsCode,
      backupTsCodes: [],
    };

    expect(() => validateEtfResearchRegistry([first, duplicate])).toThrow(
      /assigned to more than one exposure/,
    );
  });
});
