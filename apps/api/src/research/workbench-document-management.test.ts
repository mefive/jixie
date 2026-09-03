import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  conversationFindMany: vi.fn(),
  conversationFindFirst: vi.fn(),
  conversationUpdate: vi.fn(),
  runtimeClose: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    agentConversation: {
      findMany: mocks.conversationFindMany,
      findFirst: mocks.conversationFindFirst,
      update: mocks.conversationUpdate,
    },
  },
}));

vi.mock('./workbench-runtime.js', () => ({
  ResearchPythonExecutionError: class ResearchPythonExecutionError extends Error {},
  ResearchPythonInterruptionError: class ResearchPythonInterruptionError extends Error {},
  researchRuntimeManager: { close: mocks.runtimeClose },
}));

import {
  archiveResearchDocument,
  listResearchDocuments,
  restoreResearchDocument,
} from './workbench.js';

describe('research document management', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.conversationFindMany.mockResolvedValue([]);
  });

  it('lists active and archived documents with separate ordering', async () => {
    await listResearchDocuments('user-a');
    expect(mocks.conversationFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { userId: 'user-a', surface: 'research', archivedAt: null },
        orderBy: { updatedAt: 'desc' },
      }),
    );

    await listResearchDocuments('user-a', 'archived');
    expect(mocks.conversationFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-a',
          surface: 'research',
          archivedAt: { not: null },
        },
        orderBy: { archivedAt: 'desc' },
      }),
    );
  });

  it('returns archive metadata with the document summary', async () => {
    mocks.conversationFindMany.mockResolvedValue([
      {
        id: 'document-a',
        title: 'Archived research',
        archivedAt: new Date('2026-09-01T08:00:00Z'),
        createdAt: new Date('2026-08-01T08:00:00Z'),
        updatedAt: new Date('2026-08-30T08:00:00Z'),
        researchDocument: { cells: [{ status: 'stale' }, { status: 'success' }] },
        messages: [{ parts: [{ type: 'text', text: 'Latest research note' }] }],
      },
    ]);

    const documents = await listResearchDocuments('user-a', 'archived');

    expect(documents).toEqual([
      {
        id: 'document-a',
        title: 'Archived research',
        preview: 'Latest research note',
        cellCount: 2,
        staleCount: 1,
        blockedCount: 0,
        archivedAt: '2026-09-01T08:00:00.000Z',
        createdAt: '2026-08-01T08:00:00.000Z',
        updatedAt: '2026-08-30T08:00:00.000Z',
      },
    ]);
  });

  it('archives an owned research document and closes its runtime', async () => {
    mocks.conversationFindFirst.mockResolvedValue({ id: 'document-a', archivedAt: null });

    await expect(archiveResearchDocument('user-a', 'document-a')).resolves.toBe(true);

    expect(mocks.conversationFindFirst).toHaveBeenCalledWith({
      where: { id: 'document-a', userId: 'user-a', surface: 'research' },
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
    await expect(restoreResearchDocument('user-b', 'document-a')).resolves.toBe(false);

    expect(mocks.conversationUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.conversationUpdate).toHaveBeenCalledWith({
      where: { id: 'document-a' },
      data: { archivedAt: null },
    });
  });
});
