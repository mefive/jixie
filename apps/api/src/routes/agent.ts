import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { AgentStreamEvent } from '@jixie/shared';
import { apiError, validateJson, validateQuery } from '../lib/httpError.js';
import * as turnBus from '../agent/turn-bus.js';
import { runReadOnlySql, jsonSafe } from '../agent/tools/read-only-sql.js';
import { CHART_ROW_CAP } from '../agent/tools/render-chart.js';
import { m } from '../i18n/index.js';

/**
 * Shared agent-turn endpoints (all surfaces). A turn is started by the surface route (strategy /
 * factor / screen) which returns a turnId; these endpoints then serve any number of subscribers:
 *   GET  /turns/:turnId/stream   SSE — first frame is a snapshot, so a page refresh re-attaches
 *   GET  /turns/running?entity=  the live turn for an entity (refresh-reattach discovery)
 *   POST /turns/:turnId/cancel   abort the upstream LLM (idempotent)
 */
export const agentRoute = new Hono();

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
  entity: z.string().regex(/^(strategy|factor|screen):[A-Za-z0-9]+$/),
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

// Guard against accidental non-GET on the stream path (avoids a confusing 404 from Hono).
agentRoute.all('/turns/:turnId/stream', (c) =>
  apiError(c, 'VALIDATION_FAILED', m(c, 'onlyGetSubscribe')),
);
