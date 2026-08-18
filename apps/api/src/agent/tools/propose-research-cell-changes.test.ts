import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
}));

vi.mock('../../research/workbench-cell-changes.js', () => ({
  prepareResearchCellChangeProposal: mocks.prepare,
}));

import { createProposeResearchCellChangesTool } from './propose-research-cell-changes.js';

const proposal = {
  version: 1 as const,
  id: 'proposal-1',
  documentId: 'document-1',
  title: 'Update hypothesis',
  summary: 'Clarify the prior hypothesis before analysis.',
  status: 'pending' as const,
  expectedDocumentUpdatedAt: '2026-08-18T08:00:00.000Z',
  expectedDocumentContentRevision: 1,
  operations: [
    {
      operationId: 'operation-1',
      cellId: 'cell-1',
      kind: 'update' as const,
      cellKind: 'markdown' as const,
      position: 0,
      expectedRevision: 2,
      beforeSource: '# Old hypothesis',
      afterSource: '# Revised hypothesis',
      addedLines: 1,
      removedLines: 1,
      afterDefinitions: [],
      afterReferences: [],
    },
  ],
  createdAt: '2026-08-18T08:00:00.000Z',
};

describe('proposeResearchCellChanges tool', () => {
  beforeEach(() => {
    mocks.prepare.mockReset();
    mocks.prepare.mockResolvedValue(proposal);
  });

  it('creates a pending review artifact without applying or running it', async () => {
    const tool = createProposeResearchCellChangesTool({
      userId: 'user-1',
      documentId: 'document-1',
      editableCellIds: new Set(['cell-1']),
    });
    const request = {
      title: 'Update hypothesis',
      summary: 'Clarify the prior hypothesis before analysis.',
      operations: [
        { kind: 'update', cellId: 'cell-1', expectedRevision: 2, source: '# Revised hypothesis' },
      ],
    };

    const result = await tool.run(request);

    expect(mocks.prepare).toHaveBeenCalledWith('user-1', 'document-1', request);
    expect(result.researchCellChange).toEqual(proposal);
    expect(JSON.parse(result.observation)).toMatchObject({
      proposalId: 'proposal-1',
      status: 'pending',
      operations: [{ kind: 'update', cellId: 'cell-1', addedLines: 1, removedLines: 1 }],
    });
    await expect(tool.run(request)).rejects.toThrow('Only one Research Cell change proposal');
    expect(mocks.prepare).toHaveBeenCalledOnce();
  });

  it('refuses to replace a Cell whose full source was truncated from Agent context', async () => {
    const tool = createProposeResearchCellChangesTool({
      userId: 'user-1',
      documentId: 'document-1',
      editableCellIds: new Set(),
    });

    await expect(
      tool.run({
        title: 'Unsafe replacement',
        summary: 'Would overwrite unseen source.',
        operations: [
          { kind: 'update', cellId: 'cell-1', expectedRevision: 2, source: '# Replacement' },
        ],
      }),
    ).rejects.toThrow('Complete source was not included');
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});
