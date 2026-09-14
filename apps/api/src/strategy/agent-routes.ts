import { ResearchEmbeddedError } from '#research/embedded/errors.js';
import { Hono } from 'hono';
import { apiError, validateJson } from '#infra/http/errors.js';
import { localeFromRequest, m } from '#infra/http/locale.js';
import { strategyAgentInputSchema, startStrategyAgentTurn } from './agent-turn.js';
import { strategyOperationApiError } from './route-errors.js';

export const strategyAgentRoute = new Hono();

strategyAgentRoute.post(
  '/:strategyId/agent/turns',
  validateJson(strategyAgentInputSchema.omit({ id: true })),
  async (c) => {
    try {
      return c.json(
        await startStrategyAgentTurn(
          c.var.userId,
          { ...c.req.valid('json'), id: c.req.param('strategyId') },
          localeFromRequest(c),
        ),
      );
    } catch (error) {
      if (error instanceof ResearchEmbeddedError) {
        return apiError(
          c,
          error.code === 'not_found' ? 'NOT_FOUND' : 'VALIDATION_FAILED',
          m(
            c,
            error.code === 'invalid_report'
              ? 'researchEmbeddedInvalidReport'
              : 'researchEmbeddedNotFound',
          ),
        );
      }
      return strategyOperationApiError(c, error);
    }
  },
);
