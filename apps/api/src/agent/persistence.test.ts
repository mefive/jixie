import type { AgentTurnTrace, MessagePart } from '@jixie/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: { $transaction: mocks.transaction },
}));

import { finishPersistentTurn } from './persistence.js';

const TRACE: AgentTurnTrace = { version: 1, steps: [], truncated: false };

describe('finishPersistentTurn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('materializes a Research Cell change part with its assistant message', async () => {
    const createdMessages: Array<{ data: Record<string, unknown> }> = [];
    const updatedMessages: Array<{ data: Record<string, unknown> }> = [];
    const createdProposals: Array<{ data: Record<string, unknown> }> = [];
    const transaction = {
      agentTurn: {
        findUnique: vi.fn().mockResolvedValue({
          conversationId: 'conversation-1',
          conversation: { surface: 'research', userId: 'user-1' },
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      agentMessage: {
        findFirst: vi.fn().mockResolvedValue({ sequence: 4 }),
        create: vi.fn().mockImplementation(async (args) => {
          createdMessages.push(args);
          return {};
        }),
        update: vi.fn().mockImplementation(async (args) => {
          updatedMessages.push(args);
          return {};
        }),
      },
      researchDocument: {
        findFirst: vi.fn().mockResolvedValue({ id: 'document-1' }),
      },
      researchCellChangeProposal: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(async (args) => {
          createdProposals.push(args);
          return {
            ...args.data,
            expectedDocumentContentRevision: args.data.expectedDocumentContentRevision ?? null,
            appliedDocumentContentRevision: null,
            reviewSessionId: null,
            reviewSequence: null,
            reviewStatus: null,
            reviewIsLatest: false,
            reviewResolvedAt: null,
            conflict: null,
            resolvedAt: null,
          };
        }),
      },
    };
    mocks.transaction.mockImplementation(async (callback) => callback(transaction));
    const proposal = {
      version: 1 as const,
      id: 'proposal-1',
      documentId: 'document-1',
      title: 'Add rolling volatility',
      summary: 'Add one Python Cell without running it.',
      status: 'pending' as const,
      expectedDocumentUpdatedAt: '2026-08-20T08:00:00.000Z',
      expectedDocumentContentRevision: 3,
      operations: [
        {
          operationId: 'operation-1',
          cellId: 'cell-new',
          kind: 'create' as const,
          cellKind: 'python' as const,
          position: 1,
          beforeSource: '' as const,
          afterSource: 'vol = returns.rolling(20).std()',
          addedLines: 1,
          removedLines: 0,
          afterDefinitions: ['vol'],
          afterReferences: ['returns'],
        },
      ],
      createdAt: '2026-08-20T08:00:00.000Z',
    };
    const parts: MessagePart[] = [
      { type: 'text', text: 'I prepared the change for review.' },
      { type: 'research_cell_change', proposal },
    ];

    const persisted = await finishPersistentTurn({
      turnId: 'turn-1',
      status: 'done',
      parts,
      trace: TRACE,
    });

    const messageId = createdMessages[0]?.data.id;
    expect(messageId).toEqual(expect.any(String));
    expect(createdProposals).toHaveLength(1);
    expect(createdProposals[0]?.data).toMatchObject({
      id: 'proposal-1',
      documentId: 'document-1',
      sourceTurnId: 'turn-1',
      sourceMessageId: messageId,
      sourcePartIndex: 1,
      status: 'pending',
    });
    expect(updatedMessages).toEqual([
      {
        where: { id: messageId },
        data: { parts: persisted },
      },
    ]);
    expect(persisted).toEqual(parts);
  });
});
