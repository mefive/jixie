import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { authRoute } from './routes/auth.js';
import { backtestRoute } from './routes/backtest.js';
import { requireAuth } from './lib/session.js';

/**
 * Start the backend.
 *   /api/health   public liveness check
 *   /api/auth/*   public (login / logout / me) — see routes/auth.ts
 *   /api/app/*    protected example prefix — gated uniformly by requireAuth
 */
export function startServer(port: number) {
  const app = buildApp();
  serve({ fetch: app.fetch, port });
  return app;
}

export function buildApp() {
  const app = new Hono();
  app.use('*', logger());

  app.get('/', (c) => c.text('jixie api ok'));
  app.get('/api/health', (c) => c.json({ ok: true }));

  // Public: the auth routes handle the login state themselves
  app.route('/api/auth', authRoute);

  // Protected prefix: apply requireAuth uniformly to this prefix before mounting business routes.
  // In phase two, mount backtest and other routes here; handlers use c.var.userId / c.var.user
  // directly.
  app.use('/api/app/*', requireAuth);
  app.route('/api/app/backtest', backtestRoute);

  return app;
}
