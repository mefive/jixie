import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';

/** 启动后端。第一期只有健康检查；二期再挂回测任务等路由。 */
export function startServer(port: number) {
  const app = new Hono();

  app.use('*', logger());
  app.get('/', (c) => c.text('jixie api ok'));
  app.get('/api/health', (c) => c.json({ ok: true }));

  serve({ fetch: app.fetch, port });
  return app;
}
