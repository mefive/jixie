import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { authRoute } from '#auth/routes.js';
import { strategyRoute, strategyDefinitionRoute } from '#strategy/routes.js';
import { marketRoute } from '#market/routes.js';
import { factorRoute, factorsRoute, factorWeatherRoute } from '#factor/routes.js';
import { researchRoute } from '#research/routes.js';
import { agentRoute } from '#agent/routes.js';
import { signalsRoute } from '#signals/routes.js';
import { sharingRoute } from '#sharing/routes.js';
import { requireAuth } from '#auth/middleware.js';
import { maintenanceGate } from '#maintenance/middleware.js';
import { maintenanceRoute } from '#maintenance/routes.js';

export function buildApp() {
  const app = new Hono();
  app.use('*', logger());

  app.get('/', (c) => c.text('jixie api ok'));
  app.get('/api/health', (c) => c.json({ ok: true }));

  // Public: the auth routes handle the login state themselves
  app.route('/api/auth', authRoute);
  app.route('/api/maintenance', maintenanceRoute);

  // Protected prefix: apply requireAuth uniformly to this prefix before mounting business routes.
  // Handlers pass c.var.userId / c.var.user to business operations for resource authorization.
  app.use('/api/app/*', maintenanceGate);
  app.use('/api/app/*', requireAuth);

  // Mount-point naming rules (docs/design/api-route-naming.md):
  //   plural   = persistable resource CRUD  (/strategies /factors)
  //   singular = workbench actions          (/strategy /factor /research — incl. analysis jobs)
  //   base     = shared product capabilities (/agent turns, /market data reads)
  app.route('/api/app/agent', agentRoute);
  app.route('/api/app/market', marketRoute);
  app.route('/api/app/strategies', strategyDefinitionRoute);
  app.route('/api/app/factors', factorsRoute);
  app.route('/api/app/factor-weather', factorWeatherRoute);
  app.route('/api/app/signals', signalsRoute);
  app.route('/api/app/library', sharingRoute);
  app.route('/api/app/strategy', strategyRoute);
  app.route('/api/app/factor', factorRoute);
  app.route('/api/app/research', researchRoute);

  return app;
}
