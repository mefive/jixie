import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { authRoute } from './routes/auth.js';
import { requireAuth } from './lib/session.js';

/**
 * 启动后端。
 *   /api/health   公开存活检查
 *   /api/auth/*   公开（login / logout / me）—— 见 routes/auth.ts
 *   /api/app/*    受保护示例前缀 —— requireAuth 统一拦
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

  // 公开：鉴权路由自己处理登录态
  app.route('/api/auth', authRoute);

  // 受保护前缀：在挂业务路由前，对该前缀统一加 requireAuth。
  // 二期把回测等路由挂到这里，handler 里直接用 c.var.userId / c.var.user。
  app.use('/api/app/*', requireAuth);
  // app.route('/api/app/backtest', backtestRoute);

  return app;
}
