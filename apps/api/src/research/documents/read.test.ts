import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  conversationFindMany: vi.fn(),
}));

vi.mock('#infra/database/prisma.js', () => ({
  prisma: {
    agentConversation: { findMany: mocks.conversationFindMany },
  },
}));

import { listResearchDocuments } from './read.js';

describe('research document queries', () => {
  beforeEach(() => {
    mocks.conversationFindMany.mockReset().mockResolvedValue([]);
  });

  it('lists active and archived documents with separate ordering', async () => {
    await listResearchDocuments('user-a');
    expect(mocks.conversationFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-a',
          surface: 'research',
          archivedAt: null,
          NOT: { researchDocument: { embeddedVersion: { isNot: null } } },
        },
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
          NOT: { researchDocument: { embeddedVersion: { isNot: null } } },
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
        researchDocument: {
          cells: [{ status: 'stale' }, { status: 'success' }, { status: 'blocked' }],
        },
        messages: [{ parts: [{ type: 'text', text: 'Latest research note' }] }],
      },
    ]);

    const documents = await listResearchDocuments('user-a', 'archived');

    expect(documents).toEqual([
      {
        id: 'document-a',
        title: 'Archived research',
        preview: 'Latest research note',
        cellCount: 3,
        staleCount: 1,
        blockedCount: 1,
        archivedAt: '2026-09-01T08:00:00.000Z',
        createdAt: '2026-08-01T08:00:00.000Z',
        updatedAt: '2026-08-30T08:00:00.000Z',
      },
    ]);
  });

  it.each([
    { type: 'text', text: 'x'.repeat(81) },
    { type: 'research', title: 'x'.repeat(81) },
    { type: 'universe', title: 'x'.repeat(81) },
  ])('limits the first supported $type message preview to 80 characters', async (part) => {
    mocks.conversationFindMany.mockResolvedValue([
      {
        id: 'document-a',
        title: null,
        archivedAt: null,
        createdAt: new Date('2026-09-01T08:00:00Z'),
        updatedAt: new Date('2026-09-01T08:00:00Z'),
        researchDocument: null,
        messages: [{ parts: [{ type: 'unsupported' }, part, { type: 'text', text: 'Later' }] }],
      },
    ]);

    expect(await listResearchDocuments('user-a')).toMatchObject([
      {
        title: '',
        preview: 'x'.repeat(80),
        cellCount: 0,
        staleCount: 0,
        blockedCount: 0,
        archivedAt: null,
      },
    ]);
  });
});
