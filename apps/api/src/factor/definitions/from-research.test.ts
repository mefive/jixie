import { beforeEach, describe, expect, it, vi } from 'vitest';
import { textMessage, type ResearchFactorHandoffV1 } from '@jixie/shared';

const mocks = vi.hoisted(() => ({
  findFactor: vi.fn(),
  findComposite: vi.fn(),
  create: vi.fn(),
}));
vi.mock('#infra/database/prisma.js', () => ({
  prisma: {
    factor: { findFirst: mocks.findFactor, create: mocks.create },
    factorComposite: { findFirst: mocks.findComposite },
  },
}));

import {
  createFactorDraftFromResearch,
  findResearchFactorDraft,
  type FactorDraftFromResearchInput,
} from './from-research.js';

const handoff: ResearchFactorHandoffV1 = {
  version: 1,
  sourceExecutionId: 'execution-1',
  sourceDocumentId: 'document-1',
  sourceContentRevision: 3,
  sourceHash: 'source-hash',
  sourceDisplayName: 'Frozen research',
  analysisKind: 'cross_sectional',
  language: 'python',
  summary: 'Generated factor summary.',
  unresolvedItems: ['Run a FactorReport.'],
  generatedAt: '2026-09-17T00:00:00.000Z',
  models: { classifier: 'classifier', codegen: 'codegen' },
};
const input: FactorDraftFromResearchInput = {
  sourceExecutionId: handoff.sourceExecutionId,
  factorKeyBase: 'research_factor',
  factorName: 'Research factor',
  analysisKind: 'cross_sectional',
  language: 'python',
  code: 'from jixie import Factor',
  messages: [textMessage('user', 'create'), textMessage('assistant', 'created')],
  handoff,
  locale: 'en',
};
const existing = {
  id: 'winner',
  key: 'winner_key',
  name: 'Winner factor',
  analysisKind: 'cross_sectional',
  language: 'python',
  researchHandoff: handoff,
};

describe('Factor drafts from Research', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.findFactor.mockResolvedValue(null);
    mocks.findComposite.mockResolvedValue(null);
    mocks.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => data);
  });

  it.each(['en', 'zh'] as const)(
    'preserves the generated data and %s description',
    async (locale) => {
      const result = await createFactorDraftFromResearch('owner', { ...input, locale });
      expect(result).toMatchObject({ factorKey: input.factorKeyBase, reused: false, handoff });
      const data = mocks.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        userId: 'owner',
        name: input.factorName,
        code: input.code,
        language: 'python',
        runtimeVersion: 'py-v1',
        messages: input.messages,
        sourceResearchExecutionId: input.sourceExecutionId,
        researchHandoff: handoff,
        [locale === 'en' ? 'descriptionEn' : 'descriptionZh']: handoff.summary,
      });
      expect(data).not.toHaveProperty(locale === 'en' ? 'descriptionZh' : 'descriptionEn');
      expect(data).not.toHaveProperty('status');
      expect(data).not.toHaveProperty('visibility');
    },
  );

  it('skips builtin, owned Factor and Composite keys with the original suffixes', async () => {
    mocks.findFactor.mockImplementation(async ({ where }: { where: { key: string } }) =>
      where.key === 'mom_2' ? { id: 'taken-factor' } : null,
    );
    mocks.findComposite.mockImplementation(async ({ where }: { where: { key: string } }) =>
      where.key === 'mom_3' ? { id: 'taken-composite' } : null,
    );

    const result = await createFactorDraftFromResearch('owner', { ...input, factorKeyBase: 'mom' });
    expect(result.factorKey).toBe('mom_4');
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.findFactor.mock.calls.map(([query]) => query.where)).toEqual(
      ['mom', 'mom_2', 'mom_3', 'mom_4'].map((key) => ({ userId: 'owner', key })),
    );
  });

  it.each([
    { base: 'a'.repeat(40), first: 'a'.repeat(32), next: 'a'.repeat(30) + '_2' },
    { base: 'a'.repeat(29) + '___', first: 'a'.repeat(29), next: 'a'.repeat(29) + '_2' },
  ])(
    'reserves suffix space and trims trailing underscores for $base',
    async ({ base, first, next }) => {
      mocks.findFactor.mockResolvedValueOnce({ id: 'taken' });
      const result = await createFactorDraftFromResearch('owner', {
        ...input,
        factorKeyBase: base,
      });
      expect(mocks.findFactor.mock.calls[0][0].where.key).toBe(first);
      expect(result.factorKey).toBe(next);
      expect(result.factorKey.length).toBeLessThanOrEqual(32);
    },
  );

  it('reuses a source-execution winner after a unique conflict', async () => {
    mocks.create.mockRejectedValueOnce({ code: 'P2002' });
    mocks.findFactor.mockResolvedValueOnce(null).mockResolvedValueOnce(existing);

    const result = await createFactorDraftFromResearch('owner', input);
    expect(result).toMatchObject({ factorId: 'winner', factorKey: 'winner_key', reused: true });
    expect(mocks.findFactor).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { userId: 'owner', sourceResearchExecutionId: 'execution-1' },
      }),
    );
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it('tries the next key when a unique conflict has no source-execution winner', async () => {
    mocks.create.mockRejectedValueOnce({ code: 'P2002' });
    const result = await createFactorDraftFromResearch('owner', input);
    expect(result).toMatchObject({ factorKey: 'research_factor_2', reused: false });
    expect(mocks.create.mock.calls.map(([query]) => query.data.key)).toEqual([
      'research_factor',
      'research_factor_2',
    ]);
  });

  it('propagates other database errors without retrying', async () => {
    const error = Object.assign(new Error('storage unavailable'), { code: 'P1001' });
    mocks.create.mockRejectedValueOnce(error);
    await expect(createFactorDraftFromResearch('owner', input)).rejects.toBe(error);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.findFactor).toHaveBeenCalledTimes(1);
  });

  it('stops after the existing 100-attempt allocation limit', async () => {
    mocks.create.mockRejectedValue({ code: 'P2002' });
    await expect(createFactorDraftFromResearch('owner', input)).rejects.toThrow(
      'Could not allocate a unique Factor key for the research handoff.',
    );
    expect(mocks.create).toHaveBeenCalledTimes(100);
    expect(mocks.create.mock.calls[99][0].data.key).toBe('research_factor_100');
  });

  it('returns null for a missing owned draft and preserves legacy TypeScript reuse', async () => {
    expect(await findResearchFactorDraft('owner', 'execution-1')).toBeNull();
    mocks.findFactor.mockResolvedValue({
      ...existing,
      language: 'typescript',
      researchHandoff: { ...handoff, language: undefined },
    });
    expect(await findResearchFactorDraft('owner', 'execution-1')).toMatchObject({
      factorId: 'winner',
      language: 'typescript',
      reused: true,
    });
    expect(mocks.findFactor).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { userId: 'owner', sourceResearchExecutionId: 'execution-1' },
      }),
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects invalid stored handoff metadata instead of creating another draft', async () => {
    mocks.findFactor.mockResolvedValue({ ...existing, researchHandoff: null });
    await expect(findResearchFactorDraft('owner', 'execution-1')).rejects.toThrow(
      'The existing Factor draft has invalid research handoff metadata.',
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
