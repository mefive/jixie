import { describe, expect, it } from 'vitest';
import {
  buildResearchLanguageDocument,
  researchCellPositionToVirtual,
  researchVirtualRangeToCell,
} from './research-language-document.js';

describe('Research language virtual document', () => {
  it('maps positions and ranges between ordered Cells and the Pyright module', () => {
    const document = buildResearchLanguageDocument([
      { id: 'cell-a', source: 'window_size = 12' },
      { id: 'cell-b', source: 'rolling = values.rolling(window_size)\nrolling.mean()' },
    ]);

    expect(researchCellPositionToVirtual(document, 'cell-b', { line: 1, character: 7 })).toEqual({
      line: 10,
      character: 7,
    });
    expect(
      researchVirtualRangeToCell(document, {
        start: { line: 9, character: 25 },
        end: { line: 9, character: 36 },
      }),
    ).toEqual({
      cellId: 'cell-b',
      range: {
        start: { line: 0, character: 25 },
        end: { line: 0, character: 36 },
      },
    });
  });

  it('does not expose the generated prelude as a Cell location', () => {
    const document = buildResearchLanguageDocument([{ id: 'cell-a', source: 'value = 1' }]);
    expect(
      researchVirtualRangeToCell(document, {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 4 },
      }),
    ).toBeNull();
  });
});
