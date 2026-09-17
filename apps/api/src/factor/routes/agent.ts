import { ResearchEmbeddedError } from '#research/embedded/errors.js';
import { Hono } from 'hono';
import { apiError, validateJson, validateParam, validateQuery } from '#infra/http/errors.js';
import { localeFromRequest, m } from '#infra/http/locale.js';
import { factorOperationApiError } from './errors.js';
import {
  factorAgentBodySchema,
  factorAgentParamsSchema,
  factorQuestionSchema,
  factorQuestionHistorySchema,
} from '../schema.js';
import { startFactorAgentTurn } from '../agent/turn.js';
import { startFactorQuestion, readFactorQuestions } from '../questions/conversations.js';

export const factorAgentRoute = new Hono();

factorAgentRoute.post(
  '/:factorId/agent/turns',
  validateJson(factorAgentBodySchema),
  validateParam(factorAgentParamsSchema),
  async (c) => {
    try {
      return c.json(
        await startFactorAgentTurn(
          c.var.userId,
          { ...c.req.valid('json'), id: c.req.valid('param').factorId },
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
      return factorOperationApiError(c, error);
    }
  },
);

factorAgentRoute.get(
  '/:factorId/questions',
  validateQuery(factorQuestionHistorySchema),
  async (c) => {
    c.header('Cache-Control', 'private, no-store');
    try {
      return c.json(
        await readFactorQuestions(
          c.var.userId,
          c.req.param('factorId'),
          c.req.valid('query'),
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
      return factorOperationApiError(c, error);
    }
  },
);

factorAgentRoute.post(
  '/questions',
  async (c, next) => {
    const input = await c.req.json().catch(() => null);
    if (input && typeof input === 'object' && !('factorKey' in input)) {
      return apiError(c, 'VALIDATION_FAILED', m(c, 'factorQuestionRefreshRequired'));
    }
    await next();
  },
  validateJson(factorQuestionSchema),
  async (c) => {
    c.header('Cache-Control', 'private, no-store');
    try {
      return c.json(
        await startFactorQuestion(c.var.userId, c.req.valid('json'), localeFromRequest(c)),
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
      return factorOperationApiError(c, error);
    }
  },
);
