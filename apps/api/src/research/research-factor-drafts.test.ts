import { beforeEach, describe, expect, it, vi } from 'vitest';
import { textMessage, type ResearchExecutionV1 } from '@jixie/shared';

const mocks = vi.hoisted(() => ({
  factorFindFirst: vi.fn(),
  factorCreate: vi.fn(),
  compositeFindFirst: vi.fn(),
  getResearchExecution: vi.fn(),
  generateResearchFactorDraft: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    factor: {
      findFirst: mocks.factorFindFirst,
      create: mocks.factorCreate,
    },
    factorComposite: { findFirst: mocks.compositeFindFirst },
  },
}));

vi.mock('./research-execution-records.js', () => ({
  getResearchExecution: mocks.getResearchExecution,
}));

vi.mock('./research-factor-handoff.js', () => ({
  generateResearchFactorDraft: mocks.generateResearchFactorDraft,
}));

import {
  createResearchFactorDraft,
  ResearchFactorDraftUnavailableError,
} from './research-factor-drafts.js';

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

  it('creates one Python py-v1 Factor with durable source metadata', async () => {
    mocks.factorCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: data.id,
      key: data.key,
      name: data.name,
      analysisKind: data.analysisKind,
      language: data.language,
      researchHandoff: data.researchHandoff,
    }));

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
      },
    });
    expect(mocks.factorCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          sourceResearchExecutionId: execution.id,
          language: 'python',
          runtimeVersion: 'py-v1',
          code: generated.code,
        }),
      }),
    );
  });

  it('reuses an existing draft without calling either LLM stage', async () => {
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
      },
    });

    const result = await createResearchFactorDraft('user-1', execution.id, 'zh');

    expect(result?.reused).toBe(true);
    expect(result?.language).toBe('python');
    expect(mocks.getResearchExecution).not.toHaveBeenCalled();
    expect(mocks.generateResearchFactorDraft).not.toHaveBeenCalled();
    expect(mocks.factorCreate).not.toHaveBeenCalled();
  });

  it('rejects an execution that has not been sealed', async () => {
    mocks.getResearchExecution.mockResolvedValue({ ...execution, promotedAt: undefined });

    await expect(createResearchFactorDraft('user-1', execution.id, 'zh')).rejects.toThrow(
      ResearchFactorDraftUnavailableError,
    );
    expect(mocks.generateResearchFactorDraft).not.toHaveBeenCalled();
  });
});
