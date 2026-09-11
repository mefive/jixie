import { Hono } from 'hono';
import { validateJson } from '#infra/http/errors.js';
import { localeFromRequest } from '#infra/http/locale.js';
import { factorOperationApiError } from './route-errors.js';
import {
  factorAgentInputSchema,
  startFactorAgentTurn,
  presetFactorQuestionSchema,
  startPresetFactorQuestion,
} from './agent-turn.js';

export const factorAgentRoute = new Hono();

factorAgentRoute.post(
  '/:factorId/agent/turns',
  validateJson(factorAgentInputSchema.omit({ id: true })),
  async (c) => {
    try {
      return c.json(
        await startFactorAgentTurn(
          c.var.userId,
          { ...c.req.valid('json'), id: c.req.param('factorId') },
          localeFromRequest(c),
        ),
      );
    } catch (error) {
      return factorOperationApiError(c, error);
    }
  },
);

factorAgentRoute.post('/questions', validateJson(presetFactorQuestionSchema), (c) => {
  try {
    return c.json(
      startPresetFactorQuestion(c.var.userId, c.req.valid('json'), localeFromRequest(c)),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});
