import { describe, expect, it } from 'vitest';
import { researchCapabilityCatalog } from './capabilities.js';

describe('research capability catalog', () => {
  it('publishes bilingual measure contracts for Python research and universes', () => {
    for (const measure of [
      ...researchCapabilityCatalog.measures,
      ...researchCapabilityCatalog.universeMeasures,
    ]) {
      expect(measure.id).not.toBe('');
      expect(measure.nameZh).not.toBe('');
      expect(measure.nameEn).not.toBe('');
      expect(measure.descriptionZh).not.toBe('');
      expect(measure.descriptionEn).not.toBe('');
    }
  });
});
