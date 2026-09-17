import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmCall } from '#infra/llm/deepseek.js';

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), update: vi.fn(), chatJson: vi.fn() }));
vi.mock('#infra/database/prisma.js', () => ({
  prisma: { factor: { findFirst: mocks.findFirst, update: mocks.update } },
}));
vi.mock('#infra/llm/deepseek.js', () => ({ chatJson: mocks.chatJson }));

import { t } from '#i18n/index.js';
import {
  generateFactorMetadata,
  refreshFactorMetadata,
  refreshOwnedFactorMetadata,
} from './metadata.js';

describe('factor metadata', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('parses structured bilingual metadata and includes recent context', async () => {
    const llm = vi.fn<LlmCall>(async () =>
      JSON.stringify({
        nameZh: '盈利收益率',
        descriptionZh: '市盈率倒数,数值越高代表估值越低。',
        descriptionEn: 'Inverse PE; higher values indicate cheaper valuation.',
      }),
    );
    const metadata = await generateFactorMetadata(
      {
        code: 'export default defineFactor({ compute: (bar) => 1 / bar.peTtm });',
        messages: [{ role: 'user', parts: [{ type: 'text', text: '做一个盈利收益率因子' }] }],
      },
      llm,
    );

    expect(metadata).toEqual({
      nameZh: '盈利收益率',
      descriptionZh: '市盈率倒数,数值越高代表估值越低。',
      descriptionEn: 'Inverse PE; higher values indicate cheaper valuation.',
    });
    expect(llm.mock.calls[0]?.[0][1]?.content).toContain('做一个盈利收益率因子');
  });

  it.each([
    { row: null, category: 'missing', message: t('en', 'factorNotFound') },
    {
      row: { status: 'published' },
      category: 'invalid',
      message: t('en', 'publishedFactorReadonly'),
    },
  ])(
    'rejects the owned refresh as $category while the Agent refresh does nothing',
    async ({ row, category, message }) => {
      mocks.findFirst.mockResolvedValue(row);
      await expect(
        refreshOwnedFactorMetadata('owner', { id: 'factor', code: 'source' }, 'en'),
      ).rejects.toMatchObject({
        name: 'FactorOperationError',
        category,
        message,
      });
      expect(mocks.findFirst).toHaveBeenCalledOnce();
      expect(mocks.findFirst.mock.calls[0][0].where).toEqual({ id: 'factor', userId: 'owner' });

      await expect(
        refreshFactorMetadata({
          factorId: 'factor',
          userId: 'owner',
          code: 'source',
          messages: [],
        }),
      ).resolves.toBeUndefined();
      expect(mocks.chatJson).not.toHaveBeenCalled();
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );

  it('refreshes metadata using saved messages and the second draft read', async () => {
    const messages = [
      { role: 'user', parts: [{ type: 'text', text: 'Use a longer ETF trend window.' }] },
    ];
    mocks.findFirst.mockResolvedValueOnce({ status: 'draft', messages }).mockResolvedValueOnce({
      status: 'draft',
      name: 'Old name',
      descriptionZh: '',
      descriptionEn: '',
      analysisKind: 'time_series',
    });
    mocks.chatJson.mockResolvedValue(
      JSON.stringify({
        nameZh: '基金趋势',
        descriptionZh: '较长窗口的基金趋势。',
        descriptionEn: 'An ETF trend over a longer window.',
      }),
    );

    await expect(
      refreshOwnedFactorMetadata('owner', { id: 'factor', code: 'new source' }, 'en'),
    ).resolves.toEqual({ ok: true });
    expect(mocks.findFirst).toHaveBeenCalledTimes(2);
    expect(mocks.findFirst.mock.calls[1][0].where).toEqual({ id: 'factor', userId: 'owner' });
    const prompt = mocks.chatJson.mock.calls[0][0];
    expect(prompt[0].content).toContain('multi-asset ETF time-series signal');
    expect(JSON.parse(prompt[1].content)).toMatchObject({
      code: 'new source',
      currentName: 'Old name',
      recentConversation: 'user: Use a longer ETF trend window.',
    });
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'factor' },
      data: {
        name: '基金趋势',
        descriptionZh: '较长窗口的基金趋势。',
        descriptionEn: 'An ETF trend over a longer window.',
      },
    });
  });

  it.each([null, { status: 'published' }])(
    'keeps the second draft check when the target changes before refresh: %j',
    async (row) => {
      mocks.findFirst
        .mockResolvedValueOnce({ status: 'draft', messages: null })
        .mockResolvedValueOnce(row);

      await expect(
        refreshOwnedFactorMetadata('owner', { id: 'factor', code: 'source' }, 'en'),
      ).resolves.toEqual({ ok: true });
      expect(mocks.findFirst).toHaveBeenCalledTimes(2);
      expect(mocks.chatJson).not.toHaveBeenCalled();
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );

  it('maps a provider failure for HTTP and preserves the original failure for the Agent', async () => {
    mocks.findFirst.mockResolvedValue({ status: 'draft', messages: null });
    const failure = new Error('Provider unavailable');
    mocks.chatJson.mockRejectedValue(failure);

    await expect(
      refreshOwnedFactorMetadata('owner', { id: 'factor', code: 'source' }, 'en'),
    ).rejects.toMatchObject({
      name: 'FactorOperationError',
      category: 'unavailable',
      message: failure.message,
    });
    await expect(
      refreshFactorMetadata({ factorId: 'factor', userId: 'owner', code: 'source', messages: [] }),
    ).rejects.toBe(failure);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
