import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { textMessage, type ResearchExecutionV1 } from '@jixie/shared';

const mocks = vi.hoisted(() => ({
  factorFindFirst: vi.fn(),
  factorCreate: vi.fn(),
  compositeFindFirst: vi.fn(),
  getResearchExecution: vi.fn(),
  generateResearchFactorDraft: vi.fn(),
}));

vi.mock('#infra/database/prisma.js', () => ({
  prisma: {
    factor: {
      findFirst: mocks.factorFindFirst,
      create: mocks.factorCreate,
    },
    factorComposite: { findFirst: mocks.compositeFindFirst },
  },
}));

vi.mock('../evidence/execution-records.js', () => ({
  getResearchExecution: mocks.getResearchExecution,
}));

vi.mock('./factor-handoff.js', () => ({
  generateResearchFactorDraft: mocks.generateResearchFactorDraft,
}));

import { createResearchFactorDraft, ResearchFactorDraftUnavailableError } from './factor-drafts.js';

const execution = {
  id: 'execution-1',
  documentId: 'document-1',
  title: 'Earnings yield',
  displayName: 'Earnings yield v1',
  contentRevision: 3,
  sourceHash: 'source-hash',
  status: 'success',
  promotedAt: '2026-08-19T10:00:00.000Z',
} as ResearchExecutionV1;

const generated = {
  analysisKind: 'cross_sectional' as const,
  language: 'python' as const,
  factorName: 'Earnings yield',
  factorKeyBase: 'earnings_yield',
  code: 'from jixie import Factor\nfactor = Factor.cross_sectional(name="Earnings yield")',
  summary: 'Reciprocal of positive trailing P/E.',
  unresolvedItems: ['Run a FactorReport.'],
  suggestedReport: {
    version: 1 as const,
    analysisKind: 'cross_sectional' as const,
    start: '20200101',
    end: '20241231',
    observationFrequency: 'monthly' as const,
    equityUniverse: '000300.SH' as const,
    minimumListingDays: 365,
    excludeRiskWarnings: true,
    hypothesis: 'Positive earnings yield predicts positive forward returns.',
    expectedDirection: 'positive' as const,
  },
  messages: [textMessage('user', 'create'), textMessage('assistant', 'created')],
};

describe('research Factor drafts', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.factorFindFirst.mockResolvedValue(null);
    mocks.compositeFindFirst.mockResolvedValue(null);
    mocks.getResearchExecution.mockResolvedValue(execution);
    mocks.generateResearchFactorDraft.mockResolvedValue(generated);
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each([
    [undefined, undefined, 'deepseek-flash', 'deepseek-flash'],
    ['custom-general', undefined, 'custom-general', 'custom-general'],
    ['custom-general', 'custom-agent', 'custom-general', 'custom-agent'],
  ])(
    'creates a Python Factor with model attribution %s / %s',
    async (general, agent, classifier, codegen) => {
      vi.stubEnv('DEEPSEEK_MODEL', general);
      vi.stubEnv('DEEPSEEK_AGENT_MODEL', agent);
      mocks.factorCreate.mockImplementation(
        async ({ data }: { data: Record<string, unknown> }) => ({
          id: data.id,
          key: data.key,
          name: data.name,
          analysisKind: data.analysisKind,
          language: data.language,
          researchHandoff: data.researchHandoff,
        }),
      );

      const result = await createResearchFactorDraft('user-1', execution.id, 'en');

      expect(result).toMatchObject({
        version: 1,
        factorName: generated.factorName,
        language: 'python',
        reused: false,
        handoff: {
          sourceExecutionId: execution.id,
          sourceHash: execution.sourceHash,
          language: 'python',
          suggestedReport: generated.suggestedReport,
          models: { classifier, codegen },
        },
      });
      expect(mocks.factorCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            sourceResearchExecutionId: execution.id,
            messages: generated.messages,
            researchHandoff: result?.handoff,
            language: 'python',
            runtimeVersion: 'py-v1',
            code: generated.code,
          }),
        }),
      );
    },
  );

  it('reuses an existing draft without calling either LLM stage', async () => {
    vi.stubEnv('DEEPSEEK_MODEL', 'deepseek-flash');
    vi.stubEnv('DEEPSEEK_AGENT_MODEL', 'deepseek-flash');
    mocks.factorFindFirst.mockResolvedValue({
      id: 'factor-1',
      key: 'earnings_yield',
      name: 'Earnings yield',
      analysisKind: 'cross_sectional',
      language: 'python',
      researchHandoff: {
        version: 1,
        language: 'python',
        sourceExecutionId: execution.id,
        models: { classifier: 'historical-classifier', codegen: 'historical-codegen' },
      },
    });

    const result = await createResearchFactorDraft('user-1', execution.id, 'zh');

    expect(result?.reused).toBe(true);
    expect(result?.language).toBe('python');
    expect(result?.handoff.models).toEqual({
      classifier: 'historical-classifier',
      codegen: 'historical-codegen',
    });
    expect(mocks.getResearchExecution).not.toHaveBeenCalled();
    expect(mocks.generateResearchFactorDraft).not.toHaveBeenCalled();
    expect(mocks.factorCreate).not.toHaveBeenCalled();
  });

  it.each([
    { ...execution, promotedAt: undefined },
    { ...execution, status: 'error' },
  ])('rejects an execution that is not successful and sealed', async (unavailable) => {
    mocks.getResearchExecution.mockResolvedValue(unavailable);

    await expect(createResearchFactorDraft('user-1', execution.id, 'zh')).rejects.toThrow(
      ResearchFactorDraftUnavailableError,
    );
    expect(mocks.generateResearchFactorDraft).not.toHaveBeenCalled();
  });

  it('returns null when the source execution is unavailable to the owner', async () => {
    mocks.factorFindFirst.mockResolvedValue(null);
    mocks.getResearchExecution.mockResolvedValue(null);
    expect(await createResearchFactorDraft('user-1', execution.id, 'en')).toBeNull();
    expect(mocks.getResearchExecution).toHaveBeenCalledWith('user-1', execution.id);
    expect(mocks.generateResearchFactorDraft).not.toHaveBeenCalled();
    expect(mocks.factorCreate).not.toHaveBeenCalled();
  });

  it('propagates generation failure before allocating or writing a target', async () => {
    mocks.factorFindFirst.mockResolvedValue(null);
    const error = new Error('generation failed');
    mocks.generateResearchFactorDraft.mockRejectedValueOnce(error);
    await expect(createResearchFactorDraft('user-1', execution.id, 'en')).rejects.toBe(error);
    expect(mocks.factorFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.factorCreate).not.toHaveBeenCalled();
    expect(mocks.compositeFindFirst).not.toHaveBeenCalled();
  });
});
