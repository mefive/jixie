import { Hono } from 'hono';
import { z } from 'zod';
import { apiError, validateQuery } from '#infra/http/errors.js';
import { m } from '#infra/http/locale.js';
import { streamSSE } from 'hono/streaming';
import type { AgentStreamEvent } from '@jixie/shared';
import * as turnBus from './turns/bus.js';
import { getTurnDetail } from './turns/read.js';

export const agentTurnRoute = new Hono();

const activeTurnQuery = z.object({
  entity: z.string().regex(/^(strategy|factor|screen|research):[A-Za-z0-9]+$/),
});

agentTurnRoute.get('/turns/active', validateQuery(activeTurnQuery), (c) => {
  const { entity } = c.req.valid('query');
  return c.json({ turnId: turnBus.findRunning(entity, c.var.userId) });
});

agentTurnRoute.get('/turns/:turnId', async (c) => {
  const result = await getTurnDetail(c.var.userId, c.req.param('turnId'));
  return result ? c.json(result) : apiError(c, 'NOT_FOUND', m(c, 'turnNotFound'));
});

agentTurnRoute.get('/turns/:turnId/stream', (c) => {
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

// Idempotent: already finished / unknown turn → { ok: true, cancelled: false }.
agentTurnRoute.post('/turns/:turnId/cancel', (c) => {
  const cancelled = turnBus.cancel(c.req.param('turnId'), c.var.userId);
  return c.json({ ok: true, cancelled });
});

// Guard against accidental non-GET on the stream path (avoids a confusing 404 from Hono).
agentTurnRoute.all('/turns/:turnId/stream', (c) =>
  apiError(c, 'VALIDATION_FAILED', m(c, 'onlyGetSubscribe')),
);
