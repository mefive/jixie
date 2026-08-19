import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  strategyFindFirst: vi.fn(),
  strategyFindMany: vi.fn(),
  strategyFindUnique: vi.fn(),
  strategyCreate: vi.fn(),
  strategyUpdate: vi.fn(),
  factorFindFirst: vi.fn(),
  factorFindMany: vi.fn(),
  factorCreate: vi.fn(),
  factorUpdate: vi.fn(),
  compositeFindFirst: vi.fn(),
  compositeFindMany: vi.fn(),
  userFindMany: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    strategy: {
      findFirst: mocks.strategyFindFirst,
      findMany: mocks.strategyFindMany,
      findUnique: mocks.strategyFindUnique,
      create: mocks.strategyCreate,
      update: mocks.strategyUpdate,
    },
    factor: {
      findFirst: mocks.factorFindFirst,
      findMany: mocks.factorFindMany,
      create: mocks.factorCreate,
      update: mocks.factorUpdate,
    },
    factorComposite: {
      findFirst: mocks.compositeFindFirst,
      findMany: mocks.compositeFindMany,
    },
    user: { findMany: mocks.userFindMany },
  },
}));

import { factorsRoute } from './factors.js';
import { libraryRoute } from './library.js';
import { strategiesRoute } from './strategies.js';

const app = new Hono();
app.use('*', async (c, next) => {
  c.set('userId', 'user-b');
  c.set('user', { id: 'user-b', email: 'reader@example.com', name: 'Reader' });
  await next();
});
app.route('/strategies', strategiesRoute);
app.route('/factors', factorsRoute);
app.route('/library', libraryRoute);

describe('multi-user asset permissions', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
  });

  it('keeps ordinary strategy reads owner-scoped', async () => {
    mocks.strategyFindFirst.mockResolvedValue(null);

    const response = await app.request('/strategies/private-a');

    expect(response.status).toBe(404);
    expect(mocks.strategyFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'private-a', userId: 'user-b' } }),
    );
  });

  it('copies a public strategy into an independent private asset owned by the reader', async () => {
    mocks.strategyFindFirst.mockResolvedValue({
      name: 'Public strategy',
      config: {
        name: 'Public strategy',
        start: '20240101',
        end: '20241231',
        initialCash: 1_000_000,
        code: 'export default defineStrategy({ onBar() {} });',
      },
    });
    mocks.strategyFindUnique.mockResolvedValue(null);
    mocks.strategyCreate.mockResolvedValue({ id: 'copy-b', name: 'Public strategy' });

    const response = await app.request('/library/strategies/public-a/copy', { method: 'POST' });

    expect(response.status).toBe(200);
    expect(mocks.strategyFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'public-a', visibility: 'public' } }),
    );
    expect(mocks.strategyCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user-b', visibility: 'private' }),
      select: { id: true, name: true },
    });
  });

  it("does not let a reader mutate another user's factor", async () => {
    mocks.factorFindFirst.mockResolvedValue(null);

    const response = await app.request('/factors/custom/factor-a', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Hijacked' }),
    });

    expect(response.status).toBe(404);
    expect(mocks.factorFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'factor-a', userId: 'user-b' } }),
    );
  });

  it('allows a reader to inspect a published public factor without granting ownership', async () => {
    mocks.factorFindFirst.mockResolvedValue({
      id: 'factor-a',
      key: 'quality',
      name: 'Quality',
      analysisKind: 'cross_sectional',
      status: 'published',
      approvedReportId: 'report-a',
      codeHash: 'hash',
      publishedAt: new Date('2026-08-01T00:00:00Z'),
      archivedAt: null,
      descriptionZh: '质量',
      descriptionEn: 'Quality',
      code: 'export default defineFactor({ compute: () => 1 });',
      messages: null,
      researchHandoff: { version: 1, sourceExecutionId: 'private-execution-a' },
      sourceResearchExecution: {
        id: 'private-execution-a',
        documentId: 'private-document-a',
        title: 'Private research',
        displayName: 'Private version',
        sequence: 1,
        promotedAt: new Date('2026-07-31T00:00:00Z'),
      },
      userId: 'user-a',
      visibility: 'public',
    });

    const response = await app.request('/factors/custom/factor-a');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      id: 'factor-a',
      owned: false,
      visibility: 'public',
      messages: null,
      researchHandoff: null,
      sourceResearchExecution: null,
    });
    expect(mocks.factorFindFirst.mock.calls[0][0].where.OR).toContainEqual({
      visibility: 'public',
      status: 'published',
    });
  });

  it('copies a public factor as a private draft under the reader', async () => {
    mocks.factorFindFirst
      .mockResolvedValueOnce({
        key: 'quality',
        name: 'Quality',
        code: 'export default defineFactor({ compute: () => 1 });',
        analysisKind: 'cross_sectional',
        descriptionZh: '质量',
        descriptionEn: 'Quality',
        messages: null,
        userId: 'user-a',
      })
      .mockResolvedValueOnce(null);
    mocks.compositeFindFirst.mockResolvedValue(null);
    mocks.factorCreate.mockResolvedValue({ id: 'copy-factor-b' });

    const response = await app.request('/factors/custom/factor-a/copy', { method: 'POST' });

    expect(response.status).toBe(200);
    const data = mocks.factorCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ userId: 'user-b', key: 'quality_v2' });
    expect(data).not.toHaveProperty('status');
    expect(data).not.toHaveProperty('visibility');
    expect(data).not.toHaveProperty('messages');
  });
});
