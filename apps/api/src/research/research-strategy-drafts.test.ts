import { beforeEach, describe, expect, it, vi } from 'vitest';
import { textMessage, type ResearchExecutionV1 } from '@jixie/shared';

const mocks = vi.hoisted(() => ({
  strategyFindFirst: vi.fn(),
  strategyFindUnique: vi.fn(),
  strategyCreate: vi.fn(),
  getResearchExecution: vi.fn(),
  generateResearchStrategyDraft: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    strategy: {
      findFirst: mocks.strategyFindFirst,
      findUnique: mocks.strategyFindUnique,
      create: mocks.strategyCreate,
    },
  },
}));

vi.mock('./research-execution-records.js', () => ({
  getResearchExecution: mocks.getResearchExecution,
}));

vi.mock('./research-strategy-handoff.js', () => ({
  generateResearchStrategyDraft: mocks.generateResearchStrategyDraft,
}));

import {
  createResearchStrategyDraft,
  ResearchStrategyDraftUnavailableError,
} from './research-strategy-drafts.js';

const execution = {
  id: 'execution-1',
  documentId: 'document-1',
  title: 'ETF rotation',
  displayName: 'ETF rotation v1',
  contentRevision: 3,
  sourceHash: 'source-hash',
  status: 'success',
  promotedAt: '2026-08-19T10:00:00.000Z',
} as ResearchExecutionV1;

const generated = {
  strategyName: 'ETF rotation',
  code: 'from jixie import Strategy\nstrategy = Strategy(name="ETF rotation")',
  summary: 'Monthly ETF momentum rotation.',
  unresolvedItems: ['Run the backtest.'],
  messages: [textMessage('user', 'create'), textMessage('assistant', 'created')],
};

describe('research Strategy drafts', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.strategyFindUnique.mockResolvedValue(null);
    mocks.getResearchExecution.mockResolvedValue(execution);
    mocks.generateResearchStrategyDraft.mockResolvedValue(generated);
  });

  it('creates one private Python py-v1 Strategy with durable source metadata', async () => {
    mocks.strategyFindFirst.mockResolvedValue(null);
    mocks.strategyCreate.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: data.id,
        name: data.name,
        config: data.config,
        researchHandoff: data.researchHandoff,
      }),
    );

    const result = await createResearchStrategyDraft('user-1', execution.id, 'en');

    expect(result).toMatchObject({
      version: 1,
      strategyName: 'ETF rotation',
      language: 'python',
      reused: false,
      handoff: {
        sourceExecutionId: execution.id,
        sourceHash: execution.sourceHash,
        language: 'python',
      },
    });
    expect(mocks.strategyCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          sourceResearchExecutionId: execution.id,
          config: expect.objectContaining({
            language: 'python',
            runtimeVersion: 'py-v1',
            code: generated.code,
          }),
        }),
      }),
    );
    expect(mocks.strategyCreate.mock.calls[0]?.[0]?.data).not.toHaveProperty('visibility');
  });

  it('reuses the existing draft without calling either LLM stage', async () => {
    mocks.strategyFindFirst.mockResolvedValue({
      id: 'strategy-1',
      name: 'ETF rotation',
      config: { language: 'python', runtimeVersion: 'py-v1' },
      researchHandoff: {
        version: 1,
        language: 'python',
        sourceExecutionId: execution.id,
      },
    });

    const result = await createResearchStrategyDraft('user-1', execution.id, 'zh');

    expect(result?.reused).toBe(true);
    expect(mocks.getResearchExecution).not.toHaveBeenCalled();
    expect(mocks.generateResearchStrategyDraft).not.toHaveBeenCalled();
    expect(mocks.strategyCreate).not.toHaveBeenCalled();
  });

  it('rejects an execution that has not been sealed', async () => {
    mocks.strategyFindFirst.mockResolvedValue(null);
    mocks.getResearchExecution.mockResolvedValue({ ...execution, promotedAt: undefined });

    await expect(createResearchStrategyDraft('user-1', execution.id, 'zh')).rejects.toThrow(
      ResearchStrategyDraftUnavailableError,
    );
    expect(mocks.generateResearchStrategyDraft).not.toHaveBeenCalled();
  });
});
