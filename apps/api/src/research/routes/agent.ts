import { researchAgentInputSchema } from '../schema.js';
import { startResearchAgentTurn, ResearchAgentTurnError } from '../agent-turn.js';
import { Hono } from 'hono';
import { apiError, validateJson } from '#infra/http/errors.js';
import { localeFromRequest, m } from '#infra/http/locale.js';
import { ResearchClarificationAnswerError } from '../proposals/clarification-records.js';

export const researchAgentRoute = new Hono();

researchAgentRoute.post('/agent/turns', validateJson(researchAgentInputSchema), async (c) => {
  try {
    return c.json(
      await startResearchAgentTurn(c.var.userId, c.req.valid('json'), localeFromRequest(c)),
    );
  } catch (error) {
    if (error instanceof ResearchAgentTurnError) {
      switch (error.reason) {
        case 'conversation_not_found':
          return apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
        case 'conversation_running':
          return apiError(c, 'VALIDATION_FAILED', m(c, 'conversationTurnInProgress'));
        case 'clarification_pending':
          return apiError(c, 'VALIDATION_FAILED', m(c, 'researchClarificationPending'));
        case 'attempt_not_found':
          return apiError(c, 'NOT_FOUND', m(c, 'researchCellChangeAttemptNotFound'));
      }
    }
    if (error instanceof ResearchClarificationAnswerError) {
      switch (error.reason) {
        case 'not_found':
          return apiError(c, 'NOT_FOUND', m(c, 'researchClarificationNotFound'));
        case 'already_resolved':
          return apiError(c, 'VALIDATION_FAILED', m(c, 'researchClarificationAlreadyResolved'));
        case 'invalid_answer':
          return apiError(c, 'VALIDATION_FAILED', m(c, 'researchClarificationInvalidAnswer'));
      }
    }
    throw error;
  }
});
