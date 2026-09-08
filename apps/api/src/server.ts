import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { authRoute } from './auth/http/auth.js';
import { strategyRoute } from './routes/strategy.js';
import { strategiesRoute } from './routes/strategies.js';
import { marketRoute } from './routes/market.js';
import { factorRoute } from './routes/factor.js';
import { researchRoute } from './routes/research.js';
import { factorsRoute } from './routes/factors.js';
import { factorWeatherRoute } from './routes/factor-weather.js';
import { agentRoute } from './routes/agent.js';
import { signalsRoute } from './routes/signals.js';
import { libraryRoute } from './routes/library.js';
import { requireAuth } from './auth/http/session.js';
import { maintenanceGate, maintenanceRoute } from './maintenance/http.js';

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
  //   plural   = persistable resource CRUD  (/strategies /factors)
  //   singular = workbench actions          (/strategy /factor /research — incl. analysis jobs)
  //   base     = truly cross-domain infra   (/agent turn bus, /market read-only helpers)
  app.route('/api/app/agent', agentRoute);
  app.route('/api/app/market', marketRoute);
  app.route('/api/app/strategies', strategiesRoute);
  app.route('/api/app/factors', factorsRoute);
  app.route('/api/app/factor-weather', factorWeatherRoute);
  app.route('/api/app/signals', signalsRoute);
  app.route('/api/app/library', libraryRoute);
  app.route('/api/app/strategy', strategyRoute);
  app.route('/api/app/factor', factorRoute);
  app.route('/api/app/research', researchRoute);

  return app;
}
