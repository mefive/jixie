import { describe, expect, it } from 'vitest';
import {
  researchCellChangeAttemptView,
  type ResearchCellChangeAttemptRow,
} from './research-cell-change-attempt-records.js';

describe('Research Cell change attempts', () => {
  it('attributes source, output, status, and environment changes to the previous attempt', () => {
    const previous = attemptRow({
      id: 'attempt-1',
      status: 'error',
      source: 'value = 1',
      output: [{ type: 'value', value: 1 }],
      environmentFingerprint: 'environment-a',
    });
    const current = attemptRow({
      id: 'attempt-2',
      status: 'success',
      source: 'value = 2',
      output: [{ type: 'value', value: 2 }],
      environmentFingerprint: 'environment-b',
    });

    const view = researchCellChangeAttemptView(current, previous);

    expect(view.comparisonToPrevious).toEqual({
      version: 1,
      previousAttemptId: 'attempt-1',
      sourceChangedCellIds: ['cell-a'],
      outputChangedCellIds: ['cell-a'],
      statusChanged: true,
      environmentChanged: true,
    });
  });
});

function attemptRow(args: {
  id: string;
  status: string;
  source: string;
  output: unknown;
  environmentFingerprint: string;
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
        revision: 2,
        source: args.source,
        status: args.status,
        output: args.output,
        error: null,
        definitions: ['value'],
        references: [],
        environmentFingerprint: args.environmentFingerprint,
        startedAt,
        finishedAt: startedAt,
        cellChangeAttemptId: args.id,
        cell: { kind: 'python', position: 1 },
      },
    ],
  } as ResearchCellChangeAttemptRow;
}
