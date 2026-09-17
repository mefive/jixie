import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  conversationFindFirst: vi.fn(),
  conversationUpdate: vi.fn(),
  runtimeClose: vi.fn(),
}));

vi.mock('#infra/database/prisma.js', () => ({
  prisma: {
    agentConversation: {
      findFirst: mocks.conversationFindFirst,
      update: mocks.conversationUpdate,
    },
  },
}));

vi.mock('../runtime/python-session.js', () => ({
  closeResearchDocumentRuntime: mocks.runtimeClose,
}));

import { archiveResearchDocument, restoreResearchDocument } from './document-operations.js';

describe('research document management', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
  });

  it('archives an owned research document and closes its runtime', async () => {
    mocks.conversationFindFirst.mockResolvedValue({ id: 'document-a', archivedAt: null });

    await expect(archiveResearchDocument('user-a', 'document-a')).resolves.toBe(true);

    expect(mocks.conversationFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'document-a',
        userId: 'user-a',
        surface: 'research',
        NOT: { researchDocument: { embeddedVersion: { isNot: null } } },
      },
      select: { id: true, archivedAt: true },
    });
    expect(mocks.conversationUpdate).toHaveBeenCalledWith({
      where: { id: 'document-a' },
      data: { archivedAt: expect.any(Date) },
    });
    expect(mocks.runtimeClose).toHaveBeenCalledWith('document-a');
  });

  it('restores only an owned research document and remains idempotent', async () => {
    mocks.conversationFindFirst
      .mockResolvedValueOnce({
        id: 'document-a',
        archivedAt: new Date('2026-09-01T08:00:00Z'),
      })
      .mockResolvedValueOnce({ id: 'document-a', archivedAt: null })
      .mockResolvedValueOnce(null);

    await expect(restoreResearchDocument('user-a', 'document-a')).resolves.toBe(true);
    await expect(restoreResearchDocument('user-a', 'document-a')).resolves.toBe(true);
    await expect(restoreResearchDocument('user-b', 'document-a')).rejects.toMatchObject({
      reason: 'document_not_found',
    });

    expect(mocks.conversationUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.conversationUpdate).toHaveBeenCalledWith({
      where: { id: 'document-a' },
      data: { archivedAt: null },
    });
  });
});
