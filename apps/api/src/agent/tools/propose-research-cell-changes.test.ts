import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  pendingClarification: vi.fn(),
}));

vi.mock('../../research/workbench-cell-changes.js', () => ({
  prepareResearchCellChangeProposal: mocks.prepare,
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    researchClarification: { findFirst: mocks.pendingClarification },
  },
}));

import { createProposeResearchCellChangesTool } from './propose-research-cell-changes.js';

function catalogEvidence() {
  return {
    sdkReadyBindingIds: new Set<string>(),
    sdkMethodNames: new Set(['data.series']),
    pythonRuntimeInspected: true,
  };
}

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
    mocks.pendingClarification.mockReset();
    mocks.pendingClarification.mockResolvedValue(null);
  });

  it('creates a pending review artifact without applying or running it', async () => {
    const tool = createProposeResearchCellChangesTool({
      userId: 'user-1',
      documentId: 'document-1',
      editableCellIds: new Set(['cell-1']),
      catalogEvidence: catalogEvidence(),
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
      catalogEvidence: catalogEvidence(),
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

  it('waits for an earlier semantic clarification before drafting changes', async () => {
    mocks.pendingClarification.mockResolvedValue({ id: 'clarification-1' });
    const tool = createProposeResearchCellChangesTool({
      userId: 'user-1',
      documentId: 'document-1',
      editableCellIds: new Set(['cell-1']),
      catalogEvidence: catalogEvidence(),
    });

    await expect(
      tool.run({
        title: 'Update hypothesis',
        summary: 'Clarify the prior hypothesis before analysis.',
        operations: [
          { kind: 'update', cellId: 'cell-1', expectedRevision: 2, source: '# Revised' },
        ],
      }),
    ).rejects.toThrow('Answer the pending Research clarification');
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it('requires the exact SDK contract query before drafting data.series code', async () => {
    const tool = createProposeResearchCellChangesTool({
      userId: 'user-1',
      documentId: 'document-1',
      editableCellIds: new Set(['cell-1']),
      catalogEvidence: {
        sdkReadyBindingIds: new Set(),
        sdkMethodNames: new Set(),
        pythonRuntimeInspected: true,
      },
    });

    await expect(
      tool.run({
        title: 'Load data',
        summary: 'Load the exact index series.',
        operations: [
          {
            kind: 'update',
            cellId: 'cell-1',
            expectedRevision: 2,
            source: 'prices = data.series("index", "000300.SH", start="20200101", end="20251231")',
          },
        ],
      }),
    ).rejects.toThrow('Query the exact data.series Research SDK contract');
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it('requires the exact SDK contract query before drafting data.yield_curve code', async () => {
    const tool = createProposeResearchCellChangesTool({
      userId: 'user-1',
      documentId: 'document-1',
      editableCellIds: new Set(['cell-1']),
      catalogEvidence: {
        sdkReadyBindingIds: new Set(),
        sdkMethodNames: new Set(),
        pythonRuntimeInspected: true,
      },
    });

    await expect(
      tool.run({
        title: 'Load yields',
        summary: 'Load the governed real-yield series.',
        operations: [
          {
            kind: 'update',
            cellId: 'cell-1',
            expectedRevision: 2,
            source:
              'real_yield = data.yield_curve("us_treasury_real", tenor="10Y", start="20200101", end="20251231")',
          },
        ],
      }),
    ).rejects.toThrow('Query the exact data.yield_curve Research SDK contract');
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it('requires the exact Python runtime capability query before drafting Python', async () => {
    const tool = createProposeResearchCellChangesTool({
      userId: 'user-1',
      documentId: 'document-1',
      editableCellIds: new Set(['cell-1']),
      catalogEvidence: {
        sdkReadyBindingIds: new Set(),
        sdkMethodNames: new Set(),
        pythonRuntimeInspected: false,
      },
    });

    await expect(
      tool.run({
        title: 'Run a hypothesis test',
        summary: 'Use the governed Python runtime.',
        operations: [
          {
            kind: 'update',
            cellId: 'cell-1',
            expectedRevision: 2,
            source: 'from scipy import stats\nstatistic, p_value = stats.ttest_1samp(returns, 0)',
          },
        ],
      }),
    ).rejects.toThrow('runtime.python');
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});
