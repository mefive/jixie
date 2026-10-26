import { describe, expect, it } from 'vitest';
import {
  researchCellChangeAttemptView,
  type ResearchCellChangeAttemptRow,
} from './attempt-records.js';

describe('Research Cell change attempts', () => {
  it('attributes source, output, status, and environment changes to the previous attempt', () => {
    const previous = attemptRow({
      id: 'attempt-1',
      status: 'error',
      revision: 1,
      output: [{ type: 'value', value: 1 }],
    });
    const current = attemptRow({
      id: 'attempt-2',
      status: 'success',
      revision: 2,
      output: [{ type: 'value', value: 2 }],
    });

    const view = researchCellChangeAttemptView(current, previous);

    expect(view.comparisonToPrevious).toEqual({
      version: 1,
      previousAttemptId: 'attempt-1',
      sourceChangedCellIds: ['cell-a'],
      outputChangedCellIds: ['cell-a'],
      statusChanged: true,
    });
  });
});

function attemptRow(args: {
  id: string;
  status: string;
  revision: number;
  output: unknown;
}): ResearchCellChangeAttemptRow {
  const startedAt = new Date('2026-08-18T10:00:00.000Z');
  return {
    id: args.id,
    documentId: 'document-a',
    proposalId: 'proposal-a',
    contentRevision: 2,
    scope: 'affected',
    rootCellIds: ['cell-a'],
    plannedCellIds: ['cell-a'],
    status: args.status,
    error: null,
    explanationTurnId: null,
    startedAt,
    finishedAt: startedAt,
    executions: [
      {
        id: `${args.id}-execution`,
        documentId: 'document-a',
        cellId: 'cell-a',
        sourceCellId: 'cell-a',
        sourcePosition: 1,
        sourceKind: 'python',
        revision: args.revision,
        status: args.status,
        output: args.output,
        error: null,
        definitions: ['value'],
        references: [],
        startedAt,
        finishedAt: startedAt,
        cellChangeAttemptId: args.id,
        researchExecutionId: null,
        cell: { kind: 'python', position: 1 },
      },
    ],
  } as ResearchCellChangeAttemptRow;
}
