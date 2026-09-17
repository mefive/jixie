import { FactorError } from '../errors.js';

import { validateJson, validateParam, validateQuery } from '#infra/http/errors.js';
import { localeFromRequest } from '#infra/http/locale.js';
import { Hono } from 'hono';

import { startFactorAgentTurn } from '../agent/turn.js';
import { readFactorQuestions, startFactorQuestion } from '../questions/conversations.js';
import {
  factorAgentBodySchema,
  factorAgentParamsSchema,
  factorQuestionHistorySchema,
  factorQuestionSchema,
} from '../schema.js';

export const factorAgentRoute = new Hono();

factorAgentRoute.post(
  '/:factorId/agent/turns',
  validateJson(factorAgentBodySchema),
  validateParam(factorAgentParamsSchema),
  async (c) => {
    return c.json(
      await startFactorAgentTurn(
        c.var.userId,
        { ...c.req.valid('json'), id: c.req.valid('param').factorId },
        localeFromRequest(c),
      ),
    );
  },
);

factorAgentRoute.get(
  '/:factorId/questions',
  validateQuery(factorQuestionHistorySchema),
  async (c) => {
    c.header('Cache-Control', 'private, no-store');

    return c.json(
      await readFactorQuestions(
        c.var.userId,
        c.req.param('factorId'),
        c.req.valid('query'),
        localeFromRequest(c),
      ),
    );
  },
);

factorAgentRoute.post(
  '/questions',
  async (c, next) => {
    const input = await c.req.json().catch(() => null);
    if (input && typeof input === 'object' && !('factorKey' in input)) {
      throw new FactorError('question_refresh_required');
    }
    await next();
  },
  validateJson(factorQuestionSchema),
  async (c) => {
    c.header('Cache-Control', 'private, no-store');

    return c.json(
      await startFactorQuestion(c.var.userId, c.req.valid('json'), localeFromRequest(c)),
    );
  },
);
