import type { AgentTurnTrace, MessagePart } from '@jixie/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  findConversation: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    $transaction: mocks.transaction,
    agentConversation: { findFirst: mocks.findConversation },
  },
}));

import { finishPersistentTurn, startPersistentTurn } from './persistence.js';
import { resolveResearchClarificationAnswer } from '../research/research-clarification-records.js';

const TRACE: AgentTurnTrace = { version: 1, steps: [], truncated: false };

describe('finishPersistentTurn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists explicit Research Cell context on the user message', async () => {
    const createdMessages: Array<{ data: Record<string, unknown> }> = [];
    const transaction = {
      agentTurn: { create: vi.fn().mockResolvedValue({}) },
      agentMessage: {
        findFirst: vi.fn().mockResolvedValue({ sequence: 2 }),
        create: vi.fn().mockImplementation(async (args) => {
          createdMessages.push(args);
          return {};
        }),
      },
    };
    mocks.findConversation.mockResolvedValue({ id: 'conversation-1' });
    mocks.transaction.mockImplementation(async (callback) => callback(transaction));
    const userParts: MessagePart[] = [
      {
        type: 'research_cell_context',
        cells: [{ cellId: 'cell-2', position: 1, kind: 'python' }],
      },
      { type: 'text', text: 'Explain this Cell.' },
    ];

    await startPersistentTurn({
      turnId: 'turn-1',
      userId: 'user-1',
      entity: { kind: 'research', id: 'conversation-1' },
      history: [],
      message: 'Explain this Cell.',
      model: 'test-model',
      userParts,
    });

    expect(createdMessages[0]?.data).toMatchObject({
      conversationId: 'conversation-1',
      role: 'user',
      parts: userParts,
      sequence: 3,
      turnId: 'turn-1',
    });
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

  it('materializes a durable Research clarification with its assistant message', async () => {
    const createdClarifications: Array<{ data: Record<string, unknown> }> = [];
    const updatedMessages: Array<{ data: Record<string, unknown> }> = [];
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
        create: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockImplementation(async (args) => {
          updatedMessages.push(args);
          return {};
        }),
      },
      researchDocument: { findFirst: vi.fn().mockResolvedValue({ id: 'document-1' }) },
      researchClarification: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(async (args) => {
          createdClarifications.push(args);
          return { ...args.data, answer: null, answeredAt: null };
        }),
      },
    };
    mocks.transaction.mockImplementation(async (callback) => callback(transaction));
    const clarification = {
      version: 1 as const,
      id: 'clarification-1',
      documentId: 'document-1',
      title: 'Choose the gold series',
      status: 'pending' as const,
      questions: [
        {
          id: 'question-1',
          prompt: 'Which series should represent gold?',
          selectionMode: 'single' as const,
          allowCustom: true,
          options: [
            {
              id: 'binding:gold-au',
              kind: 'binding' as const,
              referenceId: 'gold-au',
              labelZh: '沪金主力连续',
              labelEn: 'SHFE gold continuous future',
              descriptionZh: '人民币期货代理',
              descriptionEn: 'CNY futures proxy',
            },
            {
              id: 'keep_gap',
              kind: 'keep_gap' as const,
              labelZh: '不使用代理',
              labelEn: 'Do not substitute',
              descriptionZh: '记录数据缺口',
              descriptionEn: 'Record the data gap',
            },
          ],
        },
      ],
      createdAt: '2026-08-24T08:00:00.000Z',
    };
    const parts: MessagePart[] = [
      { type: 'text', text: 'Please choose one series.' },
      { type: 'research_clarification', clarification },
    ];

    const persisted = await finishPersistentTurn({
      turnId: 'turn-1',
      status: 'done',
      parts,
      trace: TRACE,
    });

    expect(createdClarifications).toHaveLength(1);
    expect(createdClarifications[0]?.data).toMatchObject({
      id: 'clarification-1',
      documentId: 'document-1',
      sourceTurnId: 'turn-1',
      sourcePartIndex: 1,
      status: 'pending',
    });
    expect(updatedMessages).toHaveLength(1);
    expect(persisted).toEqual(parts);
  });

  it('answers a clarification atomically and updates its source message part', async () => {
    const questions = [
      {
        id: 'question-1',
        prompt: 'Choose one',
        selectionMode: 'single' as const,
        allowCustom: true,
        options: [
          {
            id: 'binding:gold-au',
            kind: 'binding' as const,
            referenceId: 'gold-au',
            labelZh: '沪金主力连续',
            labelEn: 'SHFE gold continuous future',
            descriptionZh: '人民币期货代理',
            descriptionEn: 'CNY futures proxy',
          },
          {
            id: 'keep_gap',
            kind: 'keep_gap' as const,
            labelZh: '不使用代理',
            labelEn: 'Do not substitute',
            descriptionZh: '记录缺口',
            descriptionEn: 'Record the gap',
          },
        ],
      },
    ];
    const pending = {
      id: 'clarification-1',
      documentId: 'document-1',
      sourceTurnId: 'turn-1',
      sourceMessageId: 'message-1',
      sourcePartIndex: 1,
      title: 'Choose gold',
      questions,
      status: 'pending',
      answer: null,
      createdAt: new Date('2026-08-24T08:00:00.000Z'),
      answeredAt: null,
    };
    let answer: unknown = null;
    const sourceParts: MessagePart[] = [
      { type: 'text', text: 'Choose.' },
      {
        type: 'research_clarification',
        clarification: {
          version: 1,
          id: pending.id,
          documentId: pending.documentId,
          title: pending.title,
          status: 'pending',
          questions,
          createdAt: pending.createdAt.toISOString(),
        },
      },
    ];
    const transaction = {
      researchClarification: {
        findFirst: vi.fn().mockResolvedValue(pending),
        update: vi.fn().mockImplementation(async ({ data }) => {
          answer = data.answer;
          return {};
        }),
        findUniqueOrThrow: vi.fn().mockImplementation(async () => ({
          ...pending,
          status: 'answered',
          answer,
          answeredAt: new Date('2026-08-24T08:01:00.000Z'),
        })),
      },
      agentMessage: {
        findUnique: vi.fn().mockResolvedValue({ parts: sourceParts }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    mocks.transaction.mockImplementation(async (callback) => callback(transaction));

    const result = await resolveResearchClarificationAnswer(
      'user-1',
      'conversation-1',
      'clarification-1',
      [{ questionId: 'question-1', selectedOptionIds: ['binding:gold-au'] }],
    );

    expect(result.status).toBe('answered');
    expect(result.answer?.selections[0]).toEqual({
      questionId: 'question-1',
      selectedOptionIds: ['binding:gold-au'],
    });
    expect(transaction.agentMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'message-1' },
        data: {
          parts: expect.arrayContaining([
            expect.objectContaining({
              type: 'research_clarification',
              clarification: expect.objectContaining({ status: 'answered' }),
            }),
          ]),
        },
      }),
    );
  });
});
