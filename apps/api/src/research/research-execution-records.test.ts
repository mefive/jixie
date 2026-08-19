import { describe, expect, it } from 'vitest';
import {
  researchExecutionDag,
  type ResearchExecutionSourceCellSnapshot,
} from './research-execution-records.js';

describe('Research Execution records', () => {
  it('freezes the complete dependency graph without treating external SDK names as Cell edges', () => {
    const cells: ResearchExecutionSourceCellSnapshot[] = [
      sourceCell('load', 0, ['monthly'], ['data']),
      sourceCell('summary', 1, ['correlation'], ['monthly']),
      sourceCell('chart', 2, [], ['monthly', 'correlation', 'charts']),
      sourceCell('validation', 3, [], []),
    ];

    expect(researchExecutionDag(cells)).toEqual([
      { cellId: 'load', dependsOnCellIds: [] },
      { cellId: 'summary', dependsOnCellIds: ['load'] },
      { cellId: 'chart', dependsOnCellIds: ['load', 'summary'] },
      { cellId: 'validation', dependsOnCellIds: [] },
    ]);
  });
});

function sourceCell(
  id: string,
  position: number,
  definitions: string[],
  references: string[],
): ResearchExecutionSourceCellSnapshot {
  return {
    id,
    position,
    kind: id === 'validation' ? 'validation' : 'python',
    source: `${id} source`,
    revision: 1,
    definitions,
    references,
  };
}
