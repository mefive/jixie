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
import { factorWeatherRoute } from './routes/factor-weather.js';
import { agentRoute } from './routes/agent.js';
import { signalsRoute } from './routes/signals.js';
import { requireAuth } from './lib/session.js';
import { markRunningJobsStale } from './lib/jobs.js';
import { seedBuiltinFactors } from './factor/builtin-factors.js';
import { resetInterruptedFactorWeatherRefreshes } from './factor/weather.js';
import { markRunningAgentTurnsInterrupted } from './agent/persistence.js';
import { maintenanceGate, maintenanceRoute } from './maintenance/http.js';

/**
 * Start the backend.
 *   /api/health   public liveness check
 *   /api/auth/*   public (login / logout / me) — see routes/auth.ts
 *   /api/app/*    protected example prefix — gated uniformly by requireAuth
 */
export async function startServer(port: number) {
  const app = buildApp();
  // Any job left 'running' from a previous process is a zombie (its worker died) → mark stale.
  const [staleJobs, interruptedTurns, interruptedWeather] = await Promise.all([
    markRunningJobsStale(),
    markRunningAgentTurnsInterrupted(),
    resetInterruptedFactorWeatherRefreshes(),
  ]);
  if (staleJobs) {
    console.log(`[jixie] marked ${staleJobs} orphaned job(s) as stale`);
  }
  if (interruptedTurns) {
    console.log(`[jixie] marked ${interruptedTurns} orphaned Agent turn(s) as interrupted`);
  }
  if (interruptedWeather) {
    console.log(`[jixie] reset ${interruptedWeather} interrupted factor weather run(s) to pending`);
  }
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
  app.route('/api/maintenance', maintenanceRoute);

  // Protected prefix: apply requireAuth uniformly to this prefix before mounting business routes.
  // In phase two, mount backtest and other routes here; handlers use c.var.userId / c.var.user
  // directly.
  app.use('/api/app/*', maintenanceGate);
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
  app.route('/api/app/factor-weather', factorWeatherRoute);
  app.route('/api/app/signals', signalsRoute);
  app.route('/api/app/strategy', strategyRoute);
  app.route('/api/app/screen', screenRoute);
  app.route('/api/app/factor', factorRoute);

  return app;
}
