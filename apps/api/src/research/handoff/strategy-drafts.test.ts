import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { textMessage, type ResearchExecutionV1 } from '@jixie/shared';

const mocks = vi.hoisted(() => ({
  strategyFindFirst: vi.fn(),
  strategyFindUnique: vi.fn(),
  strategyCreate: vi.fn(),
  getResearchExecution: vi.fn(),
  generateResearchStrategyDraft: vi.fn(),
}));

vi.mock('#infra/database/prisma.js', () => ({
  prisma: {
    strategy: {
      findFirst: mocks.strategyFindFirst,
      findUnique: mocks.strategyFindUnique,
      create: mocks.strategyCreate,
    },
  },
}));

vi.mock('../evidence/execution-records.js', () => ({
  getResearchExecution: mocks.getResearchExecution,
}));

vi.mock('./strategy-handoff.js', () => ({
  generateResearchStrategyDraft: mocks.generateResearchStrategyDraft,
}));

import {
  createResearchStrategyDraft,
  ResearchStrategyDraftUnavailableError,
} from './strategy-drafts.js';

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

  afterEach(() => vi.unstubAllEnvs());

  it.each([
    [undefined, undefined, 'deepseek-flash', 'deepseek-flash'],
    ['custom-general', undefined, 'custom-general', 'custom-general'],
    ['custom-general', 'custom-agent', 'custom-general', 'custom-agent'],
  ])(
    'creates a private Python Strategy with model attribution %s / %s',
    async (general, agent, classifier, codegen) => {
      vi.stubEnv('DEEPSEEK_MODEL', general);
      vi.stubEnv('DEEPSEEK_AGENT_MODEL', agent);
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
          models: { classifier, codegen },
        },
      });
      expect(mocks.strategyCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            sourceResearchExecutionId: execution.id,
            messages: generated.messages,
            researchHandoff: result?.handoff,
            config: expect.objectContaining({
              language: 'python',
              runtimeVersion: 'py-v1',
              code: generated.code,
            }),
          }),
        }),
      );
      expect(mocks.strategyCreate.mock.calls[0]?.[0]?.data).not.toHaveProperty('visibility');
    },
  );

  it('reuses the existing draft without calling either LLM stage', async () => {
    vi.stubEnv('DEEPSEEK_MODEL', 'deepseek-flash');
    vi.stubEnv('DEEPSEEK_AGENT_MODEL', 'deepseek-flash');
    mocks.strategyFindFirst.mockResolvedValue({
      id: 'strategy-1',
      name: 'ETF rotation',
      config: { language: 'python', runtimeVersion: 'py-v1' },
      researchHandoff: {
        version: 1,
        language: 'python',
        sourceExecutionId: execution.id,
        models: { classifier: 'historical-classifier', codegen: 'historical-codegen' },
      },
    });

    const result = await createResearchStrategyDraft('user-1', execution.id, 'zh');

    expect(result?.reused).toBe(true);
    expect(result?.handoff.models).toEqual({
      classifier: 'historical-classifier',
      codegen: 'historical-codegen',
    });
    expect(mocks.getResearchExecution).not.toHaveBeenCalled();
    expect(mocks.generateResearchStrategyDraft).not.toHaveBeenCalled();
    expect(mocks.strategyCreate).not.toHaveBeenCalled();
  });

  it.each([
    { ...execution, promotedAt: undefined },
    { ...execution, status: 'error' },
  ])('rejects an execution that is not successful and sealed', async (unavailable) => {
    mocks.strategyFindFirst.mockResolvedValue(null);
    mocks.getResearchExecution.mockResolvedValue(unavailable);

    await expect(createResearchStrategyDraft('user-1', execution.id, 'zh')).rejects.toThrow(
      ResearchStrategyDraftUnavailableError,
    );
    expect(mocks.generateResearchStrategyDraft).not.toHaveBeenCalled();
  });

  it('returns null when the source execution is unavailable to the owner', async () => {
    mocks.strategyFindFirst.mockResolvedValue(null);
    mocks.getResearchExecution.mockResolvedValue(null);
    expect(await createResearchStrategyDraft('user-1', execution.id, 'en')).toBeNull();
    expect(mocks.getResearchExecution).toHaveBeenCalledWith('user-1', execution.id);
    expect(mocks.generateResearchStrategyDraft).not.toHaveBeenCalled();
    expect(mocks.strategyCreate).not.toHaveBeenCalled();
  });

  it('propagates generation failure before allocating or writing a target', async () => {
    mocks.strategyFindFirst.mockResolvedValue(null);
    const error = new Error('generation failed');
    mocks.generateResearchStrategyDraft.mockRejectedValueOnce(error);
    await expect(createResearchStrategyDraft('user-1', execution.id, 'en')).rejects.toBe(error);
    expect(mocks.strategyFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.strategyCreate).not.toHaveBeenCalled();
    expect(mocks.strategyFindUnique).not.toHaveBeenCalled();
  });
});
