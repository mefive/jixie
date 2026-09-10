import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ directory: '' }));
vi.mock('#infra/database/prisma.js', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { default: exports } = await import('@prisma/client');
  fixture.directory = mkdtempSync('/tmp/jixie-sharing-http-');
  const database = `${fixture.directory}/sharing.db`;
  writeFileSync(database, '');
  return { prisma: new exports.PrismaClient({ datasourceUrl: `file:${database}` }) };
});
import { prisma } from '#infra/database/prisma.js';
import { sharingRoute } from './routes.js';
import { copyPublicStrategy } from '#strategy/definitions/copy-public.js';

const config = {
  name: 'Public fixture',
  start: '20240102',
  end: '20240105',
  initialCash: 100_000,
  code: 'export default defineStrategy({onBar() {}});',
};
const app = new Hono();
app.use('*', async (context, next) => {
  const userId = context.req.header('x-fixture-user') ?? 'owner';
  context.set('userId', userId);
  context.set('user', await prisma.user.findUniqueOrThrow({ where: { id: userId } }));
  await next();
});
app.route('/library', sharingRoute);
function request(path: string, method = 'GET') {
  return app.request(`/library${path}`, { method, headers: { 'accept-language': 'en' } });
}

describe('Sharing catalog boundaries', () => {
  beforeAll(() => {
    execFileSync(
      process.execPath,
      [
        createRequire(import.meta.url).resolve('prisma/build/index.js'),
        'db',
        'push',
        '--skip-generate',
        '--schema',
        resolve('prisma/schema.prisma'),
      ],
      {
        env: { ...process.env, DATABASE_URL: `file:${fixture.directory}/sharing.db` },
        stdio: 'pipe',
      },
    );
  }, 30_000);
  beforeEach(async () => {
    await prisma.user.createMany({
      data: [
        { id: 'owner', email: 'owner@fixture.invalid', name: ' Reader ' },
        { id: 'publisher', email: 'publisher@fixture.invalid' },
      ],
    });
    await prisma.strategy.createMany({
      data: [
        {
          id: 'public',
          userId: 'publisher',
          name: config.name,
          config,
          visibility: 'public',
          messages: [{ role: 'user', parts: [{ type: 'text', text: 'Private conversation' }] }],
          lastResult: { marker: 'report' },
        },
        { id: 'private', userId: 'publisher', name: 'Hidden', config },
        { id: 'owned', userId: 'owner', name: config.name, config },
        {
          id: 'dependency',
          userId: 'owner',
          name: 'Private dependency',
          config: { ...config, code: "ctx.factor('private_factor', '000001.SZ')" },
        },
      ],
    });
    await prisma.factor.createMany({
      data: [
        {
          id: 'published',
          userId: 'publisher',
          key: 'public_factor',
          name: 'Published',
          code: 'fixture',
          status: 'published',
          visibility: 'public',
          language: 'python',
        },
        {
          id: 'draft',
          userId: 'publisher',
          key: 'draft_factor',
          name: 'Draft',
          code: 'fixture',
          status: 'draft',
          visibility: 'public',
        },
        {
          id: 'archived',
          userId: 'publisher',
          key: 'archived_factor',
          name: 'Archived',
          code: 'fixture',
          status: 'archived',
          visibility: 'public',
        },
        {
          id: 'ownfactor',
          userId: 'owner',
          key: 'own_factor',
          name: 'Own factor',
          code: 'fixture',
          status: 'published',
        },
      ],
    });
    await prisma.factorComposite.createMany({
      data: [
        {
          id: 'composite',
          userId: 'publisher',
          key: 'public_composite',
          name: 'Composite',
          definition: {},
          status: 'published',
          visibility: 'public',
        },
        {
          id: 'legacy',
          userId: 'publisher',
          name: 'No key',
          definition: {},
          status: 'published',
          visibility: 'public',
        },
      ],
    });
  });
  afterEach(async () => {
    // Factor ownership is a scalar field without a cascading User relation.
    await prisma.factor.deleteMany();
    await prisma.user.deleteMany();
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await rm(fixture.directory, { recursive: true, force: true });
  });

  it('lists only eligible public assets and keeps the own-strategy dependency rule', async () => {
    const response = await request('');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.strategies).toMatchObject([
      { id: 'public', owned: false, author: 'p***@fixture.invalid' },
    ]);
    expect(body.strategies).toHaveLength(1);
    expect(body.factors.map((asset: { id: string }) => asset.id).sort()).toEqual([
      'composite',
      'published',
    ]);
    expect(body.factors.find((asset: { id: string }) => asset.id === 'published')).toMatchObject({
      kind: 'factor',
      language: 'python',
    });
    expect(body.mine.strategies).toMatchObject([
      { id: 'owned', author: 'Reader', owned: true, visibility: 'private' },
    ]);
    expect(body.mine.strategies).toHaveLength(1);
    expect(body.mine.factors).toMatchObject([{ id: 'ownfactor', visibility: 'private' }]);
    expect(body.mine.factors).toHaveLength(1);
  });

  it('preserves public strategy detail and rejects private or missing sources', async () => {
    const detail = await (await request('/strategies/public')).json();
    expect(detail).toMatchObject({
      id: 'public',
      name: config.name,
      config,
      author: 'p***@fixture.invalid',
    });
    expect(Object.keys(detail).sort()).toEqual(
      ['id', 'name', 'config', 'updatedAt', 'user', 'author'].sort(),
    );
    for (const id of ['private', 'missing']) {
      expect((await request(`/strategies/${id}`)).status).toBe(404);
      expect((await request(`/strategies/${id}/copy`, 'POST')).status).toBe(404);
      expect(await copyPublicStrategy('owner', id)).toBeNull();
    }
  });

  it('copies configuration with a unique private name and no source conversation or report', async () => {
    const source = await prisma.strategy.findUniqueOrThrow({ where: { id: 'public' } });
    const copied = await (await request('/strategies/public/copy', 'POST')).json();
    expect(copied).toEqual({ id: expect.any(String), name: `${config.name} 2` });
    const row = await prisma.strategy.findUniqueOrThrow({ where: { id: copied.id } });
    expect(row).toMatchObject({
      userId: 'owner',
      name: copied.name,
      config: { ...config, name: copied.name },
      visibility: 'private',
      lastResult: null,
      messages: null,
    });
    expect(await prisma.strategy.findUniqueOrThrow({ where: { id: 'public' } })).toEqual(source);
    expect(await prisma.strategyDeployment.count()).toBe(0);
    expect(await prisma.backtestReport.count()).toBe(0);
    const second = await copyPublicStrategy('owner', 'public');
    expect(second?.name).toBe(`${config.name} 3`);
  });
});
