import { afterEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { withDatabase, type Prisma } from '#infra/database/prisma.js';
import { handleApiError } from '#infra/http/errors.js';
import { authRoute } from '#auth/routes.js';
import { createSession } from '#auth/session.js';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { emptySelections, ingestionSource, ingestionTime } from '../../tests/ingestion-source.js';
import { ingestCandidate } from './replica.js';
import { ingestionRoute } from './routes.js';

afterEach(() => vi.unstubAllEnvs());

async function setup(database: Prisma) {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('JIXIE_ADMIN_EMAILS', ' ADMIN@example.test ');
  await emptySelections(database);
  const sessions: Record<string, string> = {};
  for (const id of ['admin', 'reader']) {
    await database.user.create({ data: { id, email: `${id}@example.test` } });
    const session = await createSession(id);
    sessions[id] = `sid=${session.id}`;
  }
  const app = new Hono().onError(handleApiError);
  app.use('*', (_context, next) => withDatabase(database, next));
  app.route('/api/auth', authRoute);
  app.route('/api/ingestion', ingestionRoute);

  return { app, sessions };
}

it(
  'authorizes on the server, checks the reviewed version and publishes without holding a reader gate',
  async () =>
    withSyncDatabase(async (database) => {
      const { app, sessions } = await setup(database);
      const staged = await ingestCandidate(
        {
          targetDate: '19910104',
          source: ingestionSource(),
          clock: () => ingestionTime,
          onLog: () => {},
        },
        true,
      );
      const path = `/api/ingestion/runs/${staged.runId}`;
      expect((await app.request(path)).status).toBe(401);
      expect((await app.request(path, { headers: { cookie: sessions.reader } })).status).toBe(403);
      const reviewed = await app.request(path, { headers: { cookie: sessions.admin } });
      expect(reviewed.status).toBe(200);
      const candidate = await reviewed.json();
      expect(candidate).toMatchObject({
        targetDate: '19910104',
        phase: 'awaiting_publish',
        pending: 0,
        execution: { failed: 0, partial: 0 },
      });
      const accept = (cookie: string, version: string) =>
        app.request(`${path}/accept`, {
          method: 'POST',
          headers: { cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ expectedCandidateVersion: version }),
        });
      expect(
        (
          await app.request(`${path}/accept`, {
            method: 'POST',
            headers: { cookie: sessions.admin, 'content-type': 'application/json' },
            body: JSON.stringify({}),
          })
        ).status,
      ).toBe(400);
      expect((await accept(sessions.reader, candidate.candidateVersion)).status).toBe(403);
      expect((await accept(sessions.admin, 'a'.repeat(64))).status).toBe(409);
      expect(await database.daily.count()).toBe(0);
      vi.stubEnv('JIXIE_ADMIN_EMAILS', '');
      expect((await accept(sessions.admin, candidate.candidateVersion)).status).toBe(403);
      vi.stubEnv('JIXIE_ADMIN_EMAILS', 'admin@example.test');
      const published = await accept(sessions.admin, candidate.candidateVersion);
      expect(published.status).toBe(200);
      expect(await published.json()).toMatchObject({ mode: 'published', runId: staged.runId });
      expect(await database.daily.count()).toBeGreaterThan(0);
      expect(await (await accept(sessions.admin, candidate.candidateVersion)).json()).toMatchObject(
        { mode: 'already_published', runId: staged.runId },
      );
    }),
  60_000,
);

it('returns matching UI capabilities and grants development access only to active signed-in users', async () =>
  withSyncDatabase(async (database) => {
    const { app, sessions } = await setup(database);
    for (const [id, expected] of [
      ['reader', false],
      ['admin', true],
    ] as const) {
      const me = await app.request('/api/auth/me', { headers: { cookie: sessions[id] } });
      expect(await me.json()).toMatchObject({
        user: { capabilities: { publishIngestion: expected } },
      });
    }
    const missing = '/api/ingestion/runs/01M6NTTSCH4423N5VQ2F2CG8R6';
    vi.stubEnv('NODE_ENV', 'development');
    const me = await app.request('/api/auth/me', { headers: { cookie: sessions.reader } });
    expect(await me.json()).toMatchObject({ user: { capabilities: { publishIngestion: true } } });
    expect((await app.request(missing, { headers: { cookie: sessions.reader } })).status).toBe(404);
    await database.user.update({ where: { id: 'reader' }, data: { status: 'disabled' } });
    expect((await app.request(missing, { headers: { cookie: sessions.reader } })).status).toBe(401);
  }));

it(
  'keeps candidates with pending diagnostics protected even when the caller is an administrator',
  async () =>
    withSyncDatabase(async (database) => {
      const { app, sessions } = await setup(database);
      const staged = await ingestCandidate(
        {
          targetDate: '19910104',
          source: ingestionSource({
            prices: (date) => [
              {
                ts_code: '600000.SH',
                trade_date: date,
                open: 10,
                high: 12,
                low: date === '19910104' ? 11 : 9,
                close: 11,
              },
            ],
          }),
          clock: () => ingestionTime,
          onLog: () => {},
        },
        true,
      );
      const path = `/api/ingestion/runs/${staged.runId}`;
      const candidate = await (
        await app.request(path, { headers: { cookie: sessions.admin } })
      ).json();
      expect(candidate.pending).toBeGreaterThan(0);
      const published = await app.request(`${path}/accept`, {
        method: 'POST',
        headers: { cookie: sessions.admin, 'content-type': 'application/json' },
        body: JSON.stringify({ expectedCandidateVersion: candidate.candidateVersion }),
      });

      expect(published.status).toBe(409);
      expect(await database.daily.count()).toBe(0);
    }),
  60_000,
);
