import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { authRoute } from './routes/auth.js';
import { strategyRoute } from './routes/strategy.js';
import { strategiesRoute } from './routes/strategies.js';
import { screenRoute } from './routes/screen.js';
import { screensRoute } from './routes/screens.js';
import { marketRoute } from './routes/market.js';
import { factorRoute } from './routes/factor.js';
import { factorsRoute } from './routes/factors.js';
import { agentRoute } from './routes/agent.js';
import { requireAuth } from './lib/session.js';
import { markRunningJobsStale } from './lib/jobs.js';
import { seedBuiltinFactors } from './factor/builtin-factors.js';
import { markRunningAgentTurnsInterrupted } from './agent/persistence.js';

/**
 * Start the backend.
 *   /api/health   public liveness check
 *   /api/auth/*   public (login / logout / me) — see routes/auth.ts
 *   /api/app/*    protected example prefix — gated uniformly by requireAuth
 */
export function startServer(port: number) {
  const app = buildApp();
  // Any job left 'running' from a previous process is a zombie (its worker died) → mark stale.
  void markRunningJobsStale().then(
    (n) => n && console.log(`[jixie] marked ${n} orphaned job(s) as stale`),
  );
  void markRunningAgentTurnsInterrupted().then(
    (count) =>
      count && console.log(`[jixie] marked ${count} orphaned Agent turn(s) as interrupted`),
  );
  // Materialize the built-in preset factors (idempotent; repo is the source of truth).
  void seedBuiltinFactors().catch((e) => console.error('[jixie] preset factor seed failed', e));
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

  // Mount-point naming rules (docs/design/api-route-naming.md):
  //   plural   = persistable resource CRUD  (/strategies /screens /factors)
  //   singular = workbench actions          (/strategy /screen /factor — incl. backtest/analysis jobs)
  //   base     = truly cross-domain infra   (/agent turn bus, /market read-only helpers)
  app.route('/api/app/agent', agentRoute);
  app.route('/api/app/market', marketRoute);
  app.route('/api/app/strategies', strategiesRoute);
  app.route('/api/app/screens', screensRoute);
  app.route('/api/app/factors', factorsRoute);
  app.route('/api/app/strategy', strategyRoute);
  app.route('/api/app/screen', screenRoute);
  app.route('/api/app/factor', factorRoute);

  return app;
}
