import { agentRoute } from '#agent/routes/index.js';
import { maintenanceGate } from '#maintenance/middleware.js';
import { maintenanceRoute } from '#maintenance/routes.js';
import { requireAuth } from '#auth/middleware.js';
import { authRoute } from '#auth/routes.js';
import { factorRoute } from '#factor/routes/index.js';
import { handleApiError } from '#infra/http/errors.js';
import { marketRoute } from '#market/routes/index.js';
import { researchRoute } from '#research/routes/index.js';
import { sharingRoute } from '#sharing/routes.js';
import { signalsRoute } from '#signals/routes/index.js';
import { strategyRoute } from '#strategy/routes/index.js';
import { Hono } from 'hono';
import { logger } from 'hono/logger';

export function buildApp() {
  const app = new Hono();
  app.onError(handleApiError);
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

  // Each business module owns one prefix; resource paths identify its operations.
  // See docs/design/api-route-naming.md for the public HTTP contract.
  app.route('/api/app/agent', agentRoute);
  app.route('/api/app/market', marketRoute);
  app.route('/api/app/strategies', strategyRoute);
  app.route('/api/app/factors', factorRoute);
  app.route('/api/app/signals', signalsRoute);
  app.route('/api/app/library', sharingRoute);
  app.route('/api/app/research', researchRoute);

  return app;
}
