import { describe, expect, it } from 'vitest';
import { downstreamResearchCellIds } from './workbench.js';

describe('reactive research dependencies', () => {
  it('marks transitive dependents without invalidating independent validation cells', () => {
    const stale = downstreamResearchCellIds('load', new Set(['monthly']), [
      { cellId: 'load', definitions: ['monthly'], references: [] },
      { cellId: 'summary', definitions: ['correlation'], references: ['monthly'] },
      { cellId: 'chart', definitions: ['figure'], references: ['correlation'] },
      { cellId: 'validation', definitions: [], references: [] },
    ]);

    expect(stale).toEqual(['summary', 'chart']);
  });

  it('uses removed definitions as stale seeds', () => {
    const stale = downstreamResearchCellIds('load', new Set(['oldFrame']), [
      { cellId: 'load', definitions: ['newFrame'], references: [] },
      { cellId: 'consumer', definitions: [], references: ['oldFrame'] },
    ]);

    expect(stale).toEqual(['consumer']);
  });
});
