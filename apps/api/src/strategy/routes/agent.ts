import { validateJson, validateParam } from '#infra/http/errors.js';
import { localeFromRequest } from '#infra/http/locale.js';
import { Hono } from 'hono';
import { startStrategyAgentTurn } from '../agent/turn.js';
import { strategyAgentBodySchema, strategyAgentParamsSchema } from '../schema.js';

export const strategyAgentRoute = new Hono();

strategyAgentRoute.post(
  '/:strategyId/agent/turns',
  validateJson(strategyAgentBodySchema),
  validateParam(strategyAgentParamsSchema),
  async (c) => {
    return c.json(
      await startStrategyAgentTurn(
        c.var.userId,
        { ...c.req.valid('json'), id: c.req.valid('param').strategyId },
        localeFromRequest(c),
      ),
    );
  },
);
