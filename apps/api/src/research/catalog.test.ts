import { describe, expect, it } from 'vitest';
import { researchCapabilityCatalog } from './catalog.js';

describe('research capability catalog', () => {
  it('publishes a complete bilingual contract for every protocol', () => {
    for (const protocol of researchCapabilityCatalog.protocols) {
      expect(protocol.questionKinds).toContain(protocol.id);
      expect(protocol.assumptions.length).toBeGreaterThan(0);
      expect(protocol.parameters.some((parameter) => parameter.adjustable)).toBe(true);
      expect(protocol.terminology.length).toBeGreaterThan(0);
      expect(protocol.formulae.length).toBeGreaterThan(0);
      expect(protocol.pythonExample).toContain('import ');
      expect(protocol.helpSlugs.zh.length).toBeGreaterThan(0);
      expect(protocol.helpSlugs.en.length).toBeGreaterThan(0);

      for (const item of [
        ...protocol.assumptions,
        ...protocol.parameters,
        ...protocol.terminology,
      ]) {
        expect(item.labelZh).not.toBe('');
        expect(item.labelEn).not.toBe('');
        expect(item.descriptionZh).not.toBe('');
        expect(item.descriptionEn).not.toBe('');
      }
    }
  });
});
