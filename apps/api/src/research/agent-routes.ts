import { startResearchAgentTurn, ResearchAgentTurnError } from './agent-turn.js';
import { Hono } from 'hono';
import { z } from 'zod';
import { apiError, validateJson } from '#infra/http/errors.js';
import { localeFromRequest, m } from '#infra/http/locale.js';
import { ResearchClarificationAnswerError } from './proposals/clarification-records.js';

export const researchAgentRoute = new Hono();

const clarificationSelectionSchema = z.strictObject({
  questionId: z.string().min(1).max(80),
  selectedOptionIds: z.array(z.string().min(1).max(200)).max(4).default([]),
  customText: z.string().trim().min(1).max(500).optional(),
});

const agentBody = z
  .strictObject({
    conversationId: z.string().min(1).optional(),
    message: z.string().trim().min(1).max(2000).optional(),
    contextCellIds: z.array(z.string().min(1).max(80)).max(8).default([]),
    attemptId: z.string().min(1).max(80).optional(),
    clarificationAnswer: z
      .strictObject({
        clarificationId: z.string().min(1).max(80),
        selections: z.array(clarificationSelectionSchema).min(1).max(3),
      })
      .optional(),
  })
  .superRefine((value, context) => {
    if (Boolean(value.message) === Boolean(value.clarificationAnswer)) {
      context.addIssue({
        code: 'custom',
        message: 'Provide exactly one of message or clarificationAnswer.',
      });
    }
    if (value.clarificationAnswer && (!value.conversationId || value.attemptId)) {
      context.addIssue({
        code: 'custom',
        path: ['clarificationAnswer'],
        message:
          'A clarification answer requires its conversationId and cannot explain an attempt.',
      });
    }
    if (value.clarificationAnswer && value.contextCellIds.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['contextCellIds'],
        message: 'A clarification answer cannot attach Research Cells.',
      });
    }
    if (value.attemptId && value.contextCellIds.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['contextCellIds'],
        message: 'A Cell execution explanation cannot attach additional Research Cells.',
      });
    }
  });

researchAgentRoute.post('/agent/turns', validateJson(agentBody), async (c) => {
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
