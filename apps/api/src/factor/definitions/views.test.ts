import { describe, expect, it } from 'vitest';
import { normalizeAnalysisKind } from './views.js';

describe('factor analysis kind views', () => {
  it.each(['cross_sectional', 'time_series', 'panel'] as const)(
    'preserves the supported %s kind',
    (kind) => {
      expect(normalizeAnalysisKind(kind)).toBe(kind);
    },
  );
});
