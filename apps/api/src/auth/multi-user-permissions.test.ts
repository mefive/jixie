import { handleApiError } from '#infra/http/errors.js';
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
  userFindMany: vi.fn(),
}));

vi.mock('#infra/database/prisma.js', async () => {
  const mocked = {
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
      user: { findMany: mocks.userFindMany },
    },
  };
  return {
    ...(await vi.importActual<typeof import('#infra/database/prisma.js')>(
      '#infra/database/prisma.js',
    )),
    ...mocked,
    getDatabase: () => mocked.prisma,
  };
});

import { factorRoute } from '#factor/routes/index.js';
import { strategyRoute } from '#strategy/routes/index.js';

const app = new Hono().onError(handleApiError);
app.use('*', async (c, next) => {
  c.set('userId', 'user-b');
  c.set('user', { id: 'user-b', email: 'reader@example.com', name: 'Reader' });
  await next();
});
app.route('/strategies', strategyRoute);
app.route('/factors', factorRoute);

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

  it('returns owned Strategy source without retired research handoff metadata', async () => {
    mocks.strategyFindFirst.mockResolvedValue({
      id: 'strategy-b',
      name: 'Research strategy',
      createdAt: new Date('2026-08-19T10:00:00Z'),
      updatedAt: new Date('2026-08-19T10:00:00Z'),
      config: {
        name: 'Research strategy',
        start: '20200101',
        end: '20241231',
        initialCash: 1_000_000,
        language: 'python',
        runtimeVersion: 'py-v1',
        code: 'from jixie import Strategy',
      },
      backtestReports: [],
      messages: null,
      researchHandoff: { version: 1, sourceExecutionId: 'execution-b', language: 'python' },
      sourceResearchExecution: {
        id: 'execution-b',
        documentId: 'document-b',
        title: 'Private research',
        displayName: 'Private version',
        sequence: 1,
        promotedAt: new Date('2026-08-19T09:00:00Z'),
      },
    });

    const response = await app.request('/strategies/strategy-b');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      id: 'strategy-b',
      config: { code: 'from jixie import Strategy', language: 'python' },
    });
    expect(body).not.toHaveProperty('researchHandoff');
    expect(body).not.toHaveProperty('sourceResearchExecution');
    expect(mocks.strategyFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'strategy-b', userId: 'user-b' },
      }),
    );
  });

  it("does not let a reader mutate another user's factor", async () => {
    mocks.factorFindFirst.mockResolvedValue(null);

    const response = await app.request('/factors/factor-a', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Hijacked' }),
    });

    expect(response.status).toBe(404);
    expect(mocks.factorFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'factor-a', userId: 'user-b' } }),
    );
  });

  it('keeps published factor reads owner-scoped while allowing builtins', async () => {
    mocks.factorFindFirst.mockResolvedValue(null);

    expect((await app.request('/factors/factor-a')).status).toBe(404);
    expect(mocks.factorFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'factor-a', userId: { in: ['user-b', 'builtin'] } },
      }),
    );
  });

  it('copies a builtin factor into an owned draft without authoring history', async () => {
    mocks.factorFindFirst
      .mockResolvedValueOnce({
        key: 'quality',
        name: 'Quality',
        code: 'export default defineFactor({ compute: () => 1 });',
        analysisKind: 'cross_sectional',
        language: 'typescript',
        runtimeVersion: 'ts-v1',
        descriptionZh: '质量',
        descriptionEn: 'Quality',
        messages: null,
        userId: 'builtin',
      })
      .mockResolvedValueOnce(null);
    mocks.factorCreate.mockResolvedValue({ id: 'copy-factor-b' });

    const response = await app.request('/factors/builtin-factor/copy', { method: 'POST' });

    expect(response.status).toBe(200);
    expect(mocks.factorFindFirst.mock.calls[0][0].where).toEqual({
      id: 'builtin-factor',
      userId: { in: ['user-b', 'builtin'] },
    });
    const data = mocks.factorCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ userId: 'user-b', key: 'quality_v2' });
    expect(data).not.toHaveProperty('status');
    expect(data).not.toHaveProperty('visibility');
    expect(data).not.toHaveProperty('messages');
  });
});
