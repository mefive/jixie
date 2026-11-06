import { expect, it } from 'vitest';
import { createSession } from '#auth/session.js';
import { withMaintenanceLock, withMarketPublication } from '#infra/coordination/market-access.js';
import { buildApp } from '../src/server.js';
import { withSyncDatabase } from './sync-database.js';

it(
  'serves publication status and rejects new readers while a SQLite write is in progress',
  async () =>
    withSyncDatabase(async (database) => {
      await database.user.create({ data: { id: 'reader', email: 'reader@example.test' } });
      const session = await createSession('reader');
      const headers = { cookie: `sid=${session.id}` };
      const app = buildApp(database);

      await withMaintenanceLock(async () => {
        const preparing = await app.request('/api/ingestion/status');
        expect(preparing.status).toBe(200);
        expect(await preparing.json()).toMatchObject({ active: false, phase: 'preparing' });

        await withMarketPublication(() =>
          database.$transaction(async (transaction) => {
            await transaction.marketDataState.create({ data: { key: 'global', revision: 1 } });
            const [status, documents, issues, auth, version] = await Promise.all([
              app.request('/api/ingestion/status'),
              app.request('/api/app/research/documents?state=active', { headers }),
              app.request('/api/ingestion/issues', { headers }),
              app.request('/api/auth/me', { headers }),
              app.request('/api/ingestion/version'),
            ]);

            const publishing = { active: true, phase: 'publishing', retryAfterSeconds: 5 };
            expect(status.status).toBe(200);
            expect(status.headers.get('Cache-Control')).toBe('no-store');
            expect(await status.json()).toEqual(publishing);
            for (const response of [documents, issues]) {
              expect(response.status).toBe(503);
              expect(response.headers.get('Retry-After')).toBe('5');
              expect(await response.json()).toMatchObject({
                error: { code: 'MAINTENANCE', details: publishing },
              });
            }
            expect(auth.status).toBe(200);
            expect(await auth.json()).toMatchObject({ user: { id: 'reader' } });
            expect(version.status).toBe(200);
          }),
        );
      });

      const status = await app.request('/api/ingestion/status');
      expect(status.status).toBe(200);
      expect(await status.json()).toMatchObject({ active: false, revision: 1, health: {} });
      expect(
        (await app.request('/api/app/research/documents?state=active', { headers })).status,
      ).toBe(200);
      expect((await app.request('/api/ingestion/issues', { headers })).status).toBe(200);
      expect((await app.request('/api/ingestion/issues')).status).toBe(401);
    }),
  30_000,
);
