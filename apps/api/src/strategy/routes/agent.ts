import { acceptCodeChangeSchema } from '@jixie/shared/api/strategy';
import { getStrategyCodeProposal, acceptStrategyCodeProposal } from '../agent/code-proposals.js';
import { validateJson, validateParam } from '#infra/http/errors.js';
import { localeFromRequest } from '#infra/http/locale.js';
import { Hono } from 'hono';
import { startStrategyAgentTurn } from '../agent/turn.js';
import { strategyAgentBodySchema } from '../schema.js';
import { strategyAgentParamsSchema } from '@jixie/shared/api/strategy';

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

strategyAgentRoute.get('/:strategyId/code-change-proposals/:proposalId', async (context) => {
  context.header('Cache-Control', 'private, no-store');
  return context.json(
    await getStrategyCodeProposal(
      context.var.userId,
      context.req.param('strategyId'),
      context.req.param('proposalId'),
    ),
  );
});

strategyAgentRoute.post(
  '/:strategyId/code-change-proposals/:proposalId/accept',
  validateJson(acceptCodeChangeSchema),
  async (context) =>
    context.json(
      await acceptStrategyCodeProposal(
        context.var.userId,
        context.req.param('strategyId'),
        context.req.param('proposalId'),
        context.req.valid('json'),
      ),
    ),
);
