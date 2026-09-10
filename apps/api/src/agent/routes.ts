import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { AgentStreamEvent } from '@jixie/shared';
import { apiError, validateJson, validateQuery } from '#infra/http/errors.js';
import * as turnBus from './turns/bus.js';
import { runReadOnlySql, jsonSafe } from './tools/sql/read-only-sql.js';
import { CHART_ROW_CAP } from './tools/charts/render-chart.js';
import { runComputeChartRows } from './tools/charts/render-computed-chart.js';
import { computeChartSpecSchema } from './tools/charts/spec.js';
import { m } from '#infra/http/locale.js';
import { listConversations, listConversationMessages } from './conversations/read.js';
import { getTurnDetail } from './turns/read.js';

/**
 * Shared agent-turn endpoints (all surfaces). A turn is started by the surface route (strategy /
 * factor / screen) which returns a turnId; these endpoints then serve any number of subscribers:
 *   GET  /turns/:turnId/stream   SSE — first frame is a snapshot, so a page refresh re-attaches
 *   GET  /turns/running?entity=  the live turn for an entity (refresh-reattach discovery)
 *   POST /turns/:turnId/cancel   abort the upstream LLM (idempotent)
 */
export const agentRoute = new Hono();

const conversationQuery = z.object({
  surface: z.enum(['strategy', 'factor', 'screen', 'research']).optional(),
  entityId: z.string().optional(),
});

agentRoute.get('/conversations', validateQuery(conversationQuery), async (c) => {
  return c.json(await listConversations(c.var.userId, c.req.valid('query')));
});

const messagesQuery = z.object({
  before: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

agentRoute.get(
  '/conversations/:conversationId/messages',
  validateQuery(messagesQuery),
  async (c) => {
    const result = await listConversationMessages(
      c.var.userId,
      c.req.param('conversationId'),
      c.req.valid('query'),
    );
    return result ? c.json(result) : apiError(c, 'NOT_FOUND', m(c, 'turnNotFound'));
  },
);

agentRoute.get('/turns/:turnId/detail', async (c) => {
  const result = await getTurnDetail(c.var.userId, c.req.param('turnId'));
  return result ? c.json(result) : apiError(c, 'NOT_FOUND', m(c, 'turnNotFound'));
});

agentRoute.get('/turns/:turnId/stream', (c) => {
  const turnId = c.req.param('turnId');
  const userId = c.var.userId;
  return streamSSE(c, async (stream) => {
    // Serialize sends: writeSSE is async but bus publishes are sync — chain them so events land on
    // the wire in publish order, and await the chain before closing so the last frame isn't lost.
    let chain = Promise.resolve();
    const send = (ev: AgentStreamEvent) => {
      chain = chain
        .then(() => stream.writeSSE({ data: JSON.stringify(ev) }))
        .catch(() => {}); /* subscriber gone — the abort handler unsubscribes */
    };

    const result = turnBus.subscribe(turnId, userId, send);
    if (result.kind === 'not_found') {
      // Expired TTL / process restart: the persisted conversation is the source of truth by now.
      send({ type: 'error', message: m(c, 'turnNotFound') });
      await chain;
      return;
    }
    if (result.kind === 'forbidden') {
      send({ type: 'error', message: m(c, 'turnForbidden') });
      await chain;
      return;
    }
    if (result.kind === 'finished') {
      await chain; // snapshot + terminal event already queued by subscribe
      return;
    }

    stream.onAbort(() => result.unsubscribe());
    await result.closed;
    await chain;
  });
});

const runningQuery = z.object({
  entity: z.string().regex(/^(strategy|factor|screen|research):[A-Za-z0-9]+$/),
});

agentRoute.get('/turns/running', validateQuery(runningQuery), (c) => {
  const { entity } = c.req.valid('query');
  return c.json({ turnId: turnBus.findRunning(entity, c.var.userId) });
});

// Idempotent: already finished / unknown turn → { ok: true, cancelled: false }.
agentRoute.post('/turns/:turnId/cancel', (c) => {
  const cancelled = turnBus.cancel(c.req.param('turnId'), c.var.userId);
  return c.json({ ok: true, cancelled });
});

const sqlBody = z.object({ sql: z.string().min(8).max(4000) });

// Read-only SQL over the market-table whitelist (same guard as the agent's sqlQuery/renderChart
// tools). Consumed by chart cards, which persist the query and re-run it on render.
agentRoute.post('/sql', validateJson(sqlBody), async (c) => {
  const { sql } = c.req.valid('json');
  try {
    const rows = await runReadOnlySql(sql, CHART_ROW_CAP);
    // Raw SQLite integers arrive as BigInt — normalize through jsonSafe before Hono serializes.
    return c.json(JSON.parse(JSON.stringify({ rows }, jsonSafe)));
  } catch (e) {
    return apiError(c, 'VALIDATION_FAILED', e instanceof Error ? e.message : m(c, 'queryFailed'));
  }
});

// Re-run a compute-source chart card (computed-chart.md Phase A): the persisted queries + code run
// through the same whitelist guard and analysis isolate as the renderComputedChart tool, and the
// validated row table comes back for the frontend to draw. Data never touches the LLM.
agentRoute.post('/chart/compute', validateJson(computeChartSpecSchema), async (c) => {
  try {
    const rows = await runComputeChartRows(c.req.valid('json'));
    return c.json(JSON.parse(JSON.stringify({ rows }, jsonSafe)));
  } catch (e) {
    return apiError(c, 'VALIDATION_FAILED', e instanceof Error ? e.message : m(c, 'queryFailed'));
  }
});

// Guard against accidental non-GET on the stream path (avoids a confusing 404 from Hono).
agentRoute.all('/turns/:turnId/stream', (c) =>
  apiError(c, 'VALIDATION_FAILED', m(c, 'onlyGetSubscribe')),
);
