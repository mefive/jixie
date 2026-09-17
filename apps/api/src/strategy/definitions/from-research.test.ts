import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BACKTEST_COST,
  DEFAULT_BACKTEST_END,
  DEFAULT_BACKTEST_INITIAL_CASH,
  DEFAULT_BACKTEST_START,
  textMessage,
  type ResearchStrategyHandoffV1,
} from '@jixie/shared';

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() }));
vi.mock('#infra/database/prisma.js', () => ({
  prisma: {
    strategy: { findFirst: mocks.findFirst, findUnique: mocks.findUnique, create: mocks.create },
  },
}));

import {
  createStrategyDraftFromResearch,
  findResearchStrategyDraft,
  type StrategyDraftFromResearchInput,
} from './from-research.js';

const handoff: ResearchStrategyHandoffV1 = {
  version: 1,
  sourceExecutionId: 'execution-1',
  sourceDocumentId: 'document-1',
  sourceContentRevision: 3,
  sourceHash: 'source-hash',
  sourceDisplayName: 'Frozen research',
  language: 'python',
  summary: 'Generated strategy summary.',
  unresolvedItems: ['Run the backtest.'],
  generatedAt: '2026-09-17T00:00:00.000Z',
  models: { classifier: 'classifier', codegen: 'codegen' },
};
const input: StrategyDraftFromResearchInput = {
  sourceExecutionId: handoff.sourceExecutionId,
  strategyName: 'Research strategy',
  code: 'from jixie import Strategy',
  messages: [textMessage('user', 'create'), textMessage('assistant', 'created')],
  handoff,
};
const existing = {
  id: 'winner',
  name: 'Winner strategy',
  config: { language: 'python', runtimeVersion: 'py-v1' },
  researchHandoff: handoff,
};

describe('Strategy drafts from Research', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.findFirst.mockResolvedValue(null);
    mocks.findUnique.mockResolvedValue(null);
    mocks.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => data);
  });

  it('allocates an owned name and preserves default configuration, messages and source', async () => {
    mocks.findUnique.mockResolvedValueOnce({ id: 'same-name' });
    const result = await createStrategyDraftFromResearch('owner', input);
    expect(result).toMatchObject({ strategyName: 'Research strategy 2', reused: false, handoff });
    expect(mocks.findUnique.mock.calls.map(([query]) => query.where)).toEqual([
      { userId_name: { userId: 'owner', name: 'Research strategy' } },
      { userId_name: { userId: 'owner', name: 'Research strategy 2' } },
    ]);
    const data = mocks.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      userId: 'owner',
      name: 'Research strategy 2',
      messages: input.messages,
      sourceResearchExecutionId: input.sourceExecutionId,
      researchHandoff: handoff,
    });
    expect(data.config).toEqual({
      name: 'Research strategy 2',
      start: DEFAULT_BACKTEST_START,
      end: DEFAULT_BACKTEST_END,
      initialCash: DEFAULT_BACKTEST_INITIAL_CASH,
      cost: DEFAULT_BACKTEST_COST,
      language: 'python',
      runtimeVersion: 'py-v1',
      code: input.code,
    });
    expect(data).not.toHaveProperty('visibility');
    expect(data).not.toHaveProperty('lastResult');
  });

  it('reuses the source-execution winner after a unique conflict', async () => {
    mocks.create.mockRejectedValueOnce({ code: 'P2002' });
    mocks.findFirst.mockResolvedValueOnce(existing);
    const result = await createStrategyDraftFromResearch('owner', input);
    expect(result).toMatchObject({
      strategyId: 'winner',
      strategyName: 'Winner strategy',
      reused: true,
    });
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'owner', sourceResearchExecutionId: 'execution-1' },
      }),
    );
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it('reallocates the name after a unique conflict without a source-execution winner', async () => {
    mocks.create.mockRejectedValueOnce({ code: 'P2002' });
    mocks.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'raced-name' });
    const result = await createStrategyDraftFromResearch('owner', input);
    expect(result).toMatchObject({ strategyName: 'Research strategy 2', reused: false });
    expect(mocks.create.mock.calls.map(([query]) => query.data.name)).toEqual([
      'Research strategy',
      'Research strategy 2',
    ]);
  });

  it('propagates other database errors without retrying or querying a race winner', async () => {
    const error = Object.assign(new Error('storage unavailable'), { code: 'P1001' });
    mocks.create.mockRejectedValueOnce(error);
    await expect(createStrategyDraftFromResearch('owner', input)).rejects.toBe(error);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it('stops after the existing 50 write attempts', async () => {
    mocks.create.mockRejectedValue({ code: 'P2002' });
    await expect(createStrategyDraftFromResearch('owner', input)).rejects.toThrow(
      'Could not allocate a unique Strategy name for the research handoff.',
    );
    expect(mocks.create).toHaveBeenCalledTimes(50);
    expect(mocks.findFirst).toHaveBeenCalledTimes(50);
  });

  it('returns null for a missing owned draft and maps an existing one as reused', async () => {
    expect(await findResearchStrategyDraft('owner', 'execution-1')).toBeNull();
    mocks.findFirst.mockResolvedValue(existing);
    expect(await findResearchStrategyDraft('owner', 'execution-1')).toMatchObject({
      strategyId: 'winner',
      language: 'python',
      handoff,
      reused: true,
    });
    expect(mocks.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { userId: 'owner', sourceResearchExecutionId: 'execution-1' },
      }),
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('retains the Python runtime requirement for stored handoffs', async () => {
    mocks.findFirst.mockResolvedValue({
      ...existing,
      config: { language: 'typescript', runtimeVersion: 'ts-v1' },
    });
    await expect(findResearchStrategyDraft('owner', 'execution-1')).rejects.toThrow(
      'The existing Strategy draft has invalid research handoff metadata.',
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
