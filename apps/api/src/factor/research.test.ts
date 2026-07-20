import { describe, expect, it } from 'vitest';
import { enoughHoldoutPeriods, researchCounts } from './research.js';

describe('factor research discipline', () => {
  it('counts completed unique exploration tests separately from reports', () => {
    const rows = [
      { phase: 'explore', status: 'done', testKey: 'a', revealedAt: null },
      { phase: 'explore', status: 'done', testKey: 'a', revealedAt: null },
      { phase: 'explore', status: 'error', testKey: 'b', revealedAt: null },
      { phase: 'legacy', status: 'done', testKey: null, revealedAt: null },
      { phase: 'holdout', status: 'done', testKey: 'a', revealedAt: new Date() },
    ];

    expect(researchCounts(rows)).toEqual({
      exploreRunCount: 2,
      exploreTestCount: 1,
      legacyRunCount: 1,
      holdoutCount: 1,
      revealedHoldoutCount: 1,
      expectedFalsePositivesAtFivePercent: 0.05,
    });
  });

  it('enforces the minimum holdout span by frequency', () => {
    expect(enoughHoldoutPeriods('month', '20250101', '20250601')).toBe(false);
    expect(enoughHoldoutPeriods('month', '20250101', '20250701')).toBe(true);
    expect(enoughHoldoutPeriods('week', '20250101', '20250301')).toBe(false);
    expect(enoughHoldoutPeriods('week', '20250101', '20250401')).toBe(true);
  });
});
