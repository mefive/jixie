import { readResearchArtifact } from './evidence/read-artifact.js';
import { submitResearchCuratorRun } from './curator/submit.js';
import {
  listResearchConversations,
  renameResearchConversation,
  deleteResearchConversation,
} from './documents/conversation-operations.js';
import { archiveIdleResearchDocument } from './documents/archive-idle-document.js';
import { startResearchAgentTurn, ResearchAgentTurnError } from './agent-turn.js';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { apiError, validateJson, validateQuery } from '../infra/http/errors.js';
import { localeFromRequest, m } from '../infra/http/locale.js';
import {
  curatorFindingUpdateSchema,
  getLatestResearchCuratorRun,
  getResearchCuratorRun,
  updateResearchCuratorFindingFeedback,
} from './curator/runs.js';
import { universeSpecV1Schema } from './datasets/spec.js';
import { executeUniverseSpec } from './datasets/universe.js';
import { researchPythonLanguageService } from './language/pyright-service.js';
import { searchResearchDataCatalog } from './catalog/data-catalog.js';
import {
  getResearchExecution,
  listResearchExecutions,
  promoteResearchExecution,
  ResearchExecutionPromotionUnavailableError,
} from './evidence/execution-records.js';
import { ResearchClarificationAnswerError } from './proposals/clarification-records.js';
import {
  createResearchFactorDraft,
  ResearchFactorDraftUnavailableError,
} from './handoff/factor-drafts.js';
import { ResearchFactorHandoffRejectedError } from './handoff/factor-handoff.js';
import {
  createResearchStrategyDraft,
  ResearchStrategyDraftUnavailableError,
} from './handoff/strategy-drafts.js';
import { ResearchStrategyHandoffRejectedError } from './handoff/strategy-handoff.js';
import { createResearchDocumentFromBacktestReport } from './documents/from-backtest-report.js';
import {
  acceptResearchCellChangeReview,
  applyResearchCellChangeProposal,
  applyResearchCellChangeProposalForReview,
  rejectResearchCellChangeProposal,
  ResearchCellChangeReviewUnavailableError,
  revertResearchCellChangeReview,
} from './proposals/cell-changes.js';
import {
  ResearchCellChangeAttemptUnavailableError,
  runResearchCellChangeProposalAttempt,
} from './proposals/attempts.js';
import {
  addResearchCell,
  deleteResearchCell,
  updateResearchCell,
} from './documents/cell-operations.js';
import { analyzeResearchDocument } from './dependencies/analyze.js';
import {
  createResearchDocument,
  listResearchDocuments,
  restoreResearchDocument,
} from './documents/document-operations.js';
import { getResearchDocument } from './documents/read.js';
import { interruptResearchDocument, resetResearchDocumentRuntime } from './execution/control.js';
import { ResearchDocumentRunInProgressError } from './execution/run-state.js';
import { ResearchAffectedRunError } from './dependencies/run-plan.js';
import { ResearchCellChangeReviewOpenError } from './proposals/review-state.js';
import { ResearchCellDependencyBlockedError } from './dependencies/runnable.js';
import { ResearchCellRevisionConflictError } from './documents/revision-errors.js';
import { runAffectedResearchCells } from './execution/run-affected.js';
import { runResearchCell } from './execution/run-cell.js';
import { runResearchDocument } from './execution/run-document.js';

/** Research HTTP validation, response formatting, and domain error mapping. */
export const researchRoute = new Hono();

const dataCatalogQuery = z.strictObject({
  q: z.string().trim().max(120).default(''),
  assetType: z.enum(['stock', 'etf', 'index', 'future']).optional(),
  scope: z
    .enum(['instruments', 'datasets', 'factor_reports', 'backtest_reports'])
    .default('instruments'),
  limit: z.coerce.number().int().min(1).max(50).default(24),
});

const documentListQuery = z.strictObject({
  state: z.enum(['active', 'archived']).default('active'),
});

researchRoute.get('/data-catalog', validateQuery(dataCatalogQuery), async (c) => {
  const query = c.req.valid('query');
  return c.json(
    await searchResearchDataCatalog({
      query: query.q,
      assetType: query.assetType,
      scope: query.scope,
      userId: c.var.userId,
      limit: query.limit,
    }),
  );
});

researchRoute.get('/artifacts/:artifactId', async (c) => {
  const artifact = await readResearchArtifact(c.var.userId, c.req.param('artifactId'));
  if (!artifact) {
    return apiError(c, 'NOT_FOUND', m(c, 'researchArtifactNotFound'));
  }

  const etag = `"${artifact.sha256}"`;
  // Revalidate ownership before reuse because one browser profile can switch accounts.
  c.header('Cache-Control', 'private, no-cache');
  c.header('ETag', etag);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Content-Security-Policy', "sandbox; default-src 'none'");
  if (c.req.header('If-None-Match') === etag) {
    return c.body(null, 304);
  }
  c.header('Content-Type', artifact.mimeType);
  c.header('Content-Length', String(artifact.byteSize));
  return c.body(new Uint8Array(artifact.data));
});

const createDocumentBody = z.strictObject({
  template: z.enum(['blank', 'index_relationship', 'equity_fcff_valuation']).default('blank'),
});
const createCellBody = z.strictObject({
  kind: z.enum(['markdown', 'python']),
  source: z.string().max(100_000).default(''),
});
const updateCellBody = z
  .strictObject({
    source: z.string().max(100_000).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    expectedRevision: z.number().int().positive(),
  })
  .refine((value) => value.source !== undefined || value.config !== undefined);
const runDocumentBody = z.strictObject({ clean: z.boolean().default(true) });
const promoteExecutionBody = z.strictObject({
  displayName: z.string().trim().min(1).max(160),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  userNote: z.string().trim().max(2_000).optional(),
});
const cellChangeReviewBody = z.strictObject({
  expectedContentRevision: z.number().int().positive(),
});
const languagePosition = z.strictObject({
  line: z.number().int().min(0).max(100_000),
  character: z.number().int().min(0).max(100_000),
});
const languageRequestBody = z
  .strictObject({
    version: z.literal(1),
    documentId: z.string().min(1).max(80),
    cells: z
      .array(
        z.strictObject({
          id: z.string().min(1).max(80),
          source: z.string().max(100_000),
        }),
      )
      .max(100),
    cellId: z.string().min(1).max(80),
    action: z.enum([
      'completion',
      'hover',
      'signature_help',
      'definition',
      'references',
      'prepare_rename',
      'rename',
      'diagnostics',
    ]),
    position: languagePosition.optional(),
    newName: z
      .string()
      .regex(/^[A-Za-z_]\w*$/)
      .max(120)
      .optional(),
  })
  .superRefine((value, context) => {
    if (value.cells.reduce((total, cell) => total + cell.source.length, 0) > 500_000) {
      context.addIssue({
        code: 'custom',
        path: ['cells'],
        message: 'Document source is too large',
      });
    }
    if (!value.cells.some((cell) => cell.id === value.cellId)) {
      context.addIssue({
        code: 'custom',
        path: ['cellId'],
        message: 'Cell is not in the document',
      });
    }
    if (value.action !== 'diagnostics' && !value.position) {
      context.addIssue({ code: 'custom', path: ['position'], message: 'Position is required' });
    }
    if (value.action === 'rename' && !value.newName) {
      context.addIssue({ code: 'custom', path: ['newName'], message: 'New name is required' });
    }
  });

researchRoute.get('/documents', validateQuery(documentListQuery), async (c) =>
  c.json(await listResearchDocuments(c.var.userId, c.req.valid('query').state)),
);

researchRoute.post('/language', validateJson(languageRequestBody), async (c) => {
  const request = c.req.valid('json');
  try {
    return c.json(
      await researchPythonLanguageService.request(`${c.var.userId}:${request.documentId}`, request),
    );
  } catch (error) {
    console.error('[jixie] Research Python language service request failed', error);
    return apiError(c, 'SERVICE_UNAVAILABLE', m(c, 'researchLanguageServiceUnavailable'));
  }
});

researchRoute.post('/documents', validateJson(createDocumentBody), async (c) =>
  c.json(await createResearchDocument(c.var.userId, c.req.valid('json').template)),
);

researchRoute.post('/documents/from-backtest-report/:reportId', async (c) => {
  const document = await createResearchDocumentFromBacktestReport(
    c.var.userId,
    c.req.param('reportId'),
  );
  return document ? c.json(document) : apiError(c, 'NOT_FOUND', m(c, 'backtestReportNotFound'));
});

researchRoute.get('/documents/:documentId', async (c) => {
  const document = await getResearchDocument(c.var.userId, c.req.param('documentId'));
  return document ? c.json(document) : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
});

researchRoute.post('/documents/:documentId/archive', async (c) => {
  try {
    const archived = await archiveIdleResearchDocument(c.var.userId, c.req.param('documentId'));
    return archived
      ? c.json({ ok: true as const })
      : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
  } catch (error) {
    if (error instanceof ResearchDocumentRunInProgressError) {
      return apiError(c, 'VALIDATION_FAILED', m(c, 'researchDocumentRunInProgress'));
    }
    throw error;
  }
});

researchRoute.post('/documents/:documentId/restore', async (c) => {
  const restored = await restoreResearchDocument(c.var.userId, c.req.param('documentId'));
  return restored
    ? c.json({ ok: true as const })
    : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
});

researchRoute.get('/documents/:documentId/executions', async (c) => {
  const executions = await listResearchExecutions(c.var.userId, c.req.param('documentId'));
  return executions ? c.json(executions) : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
});

researchRoute.get('/executions/:executionId', async (c) => {
  const execution = await getResearchExecution(c.var.userId, c.req.param('executionId'));
  return execution
    ? c.json(execution)
    : apiError(c, 'NOT_FOUND', m(c, 'researchExecutionNotFound'));
});

researchRoute.post(
  '/executions/:executionId/promote',
  validateJson(promoteExecutionBody),
  async (c) => {
    try {
      const execution = await promoteResearchExecution(
        c.var.userId,
        c.req.param('executionId'),
        c.req.valid('json'),
      );
      return execution
        ? c.json(execution)
        : apiError(c, 'NOT_FOUND', m(c, 'researchExecutionNotFound'));
    } catch (error) {
      if (error instanceof ResearchExecutionPromotionUnavailableError) {
        return apiError(c, 'VALIDATION_FAILED', m(c, 'researchExecutionPromotionUnavailable'));
      }
      throw error;
    }
  },
);

researchRoute.post('/executions/:executionId/factor-draft', async (c) => {
  try {
    const draft = await createResearchFactorDraft(
      c.var.userId,
      c.req.param('executionId'),
      localeFromRequest(c),
    );
    return draft ? c.json(draft) : apiError(c, 'NOT_FOUND', m(c, 'researchExecutionNotFound'));
  } catch (error) {
    if (error instanceof ResearchFactorDraftUnavailableError) {
      return apiError(c, 'VALIDATION_FAILED', m(c, 'researchFactorDraftUnavailable'));
    }
    if (error instanceof ResearchFactorHandoffRejectedError) {
      return apiError(c, 'VALIDATION_FAILED', error.message);
    }
    throw error;
  }
});

researchRoute.post('/executions/:executionId/strategy-draft', async (c) => {
  try {
    const draft = await createResearchStrategyDraft(
      c.var.userId,
      c.req.param('executionId'),
      localeFromRequest(c),
    );
    return draft ? c.json(draft) : apiError(c, 'NOT_FOUND', m(c, 'researchExecutionNotFound'));
  } catch (error) {
    if (error instanceof ResearchStrategyDraftUnavailableError) {
      return apiError(c, 'VALIDATION_FAILED', m(c, 'researchStrategyDraftUnavailable'));
    }
    if (error instanceof ResearchStrategyHandoffRejectedError) {
      return apiError(c, 'VALIDATION_FAILED', error.message);
    }
    throw error;
  }
});

researchRoute.post('/documents/:documentId/cells', validateJson(createCellBody), async (c) => {
  try {
    const { kind, source } = c.req.valid('json');
    const document = await addResearchCell(c.var.userId, c.req.param('documentId'), kind, source);
    return document ? c.json(document) : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
  } catch (error) {
    if (error instanceof ResearchCellChangeReviewOpenError) {
      return apiError(c, 'CONFLICT', m(c, 'researchCellChangeReviewMustResolve'));
    }
    throw error;
  }
});

researchRoute.patch('/cells/:cellId', validateJson(updateCellBody), async (c) => {
  try {
    const document = await updateResearchCell(
      c.var.userId,
      c.req.param('cellId'),
      c.req.valid('json'),
    );
    return document ? c.json(document) : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
  } catch (error) {
    if (error instanceof ResearchCellRevisionConflictError) {
      return apiError(c, 'CONFLICT', m(c, 'researchCellRevisionConflict'), {
        reason: 'cell_revision_changed',
        currentCell: error.currentCell,
      });
    }
    throw error;
  }
});

researchRoute.delete('/cells/:cellId', async (c) => {
  try {
    const document = await deleteResearchCell(c.var.userId, c.req.param('cellId'));
    return document ? c.json(document) : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
  } catch (error) {
    if (error instanceof ResearchCellChangeReviewOpenError) {
      return apiError(c, 'CONFLICT', m(c, 'researchCellChangeReviewMustResolve'));
    }
    throw error;
  }
});

researchRoute.post('/cell-change-proposals/:proposalId/apply', async (c) => {
  try {
    const result = await applyResearchCellChangeProposal(c.var.userId, c.req.param('proposalId'));
    return result
      ? c.json(result)
      : apiError(c, 'NOT_FOUND', m(c, 'researchCellChangeProposalNotFound'));
  } catch (error) {
    if (error instanceof ResearchCellChangeReviewUnavailableError) {
      return researchCellChangeReviewError(c, error);
    }
    throw error;
  }
});

researchRoute.post('/cell-change-proposals/:proposalId/apply-for-review', async (c) => {
  try {
    const result = await applyResearchCellChangeProposalForReview(
      c.var.userId,
      c.req.param('proposalId'),
    );
    return result
      ? c.json(result)
      : apiError(c, 'NOT_FOUND', m(c, 'researchCellChangeProposalNotFound'));
  } catch (error) {
    if (error instanceof ResearchCellChangeReviewUnavailableError) {
      return researchCellChangeReviewError(c, error);
    }
    throw error;
  }
});

researchRoute.post(
  '/cell-change-proposals/:proposalId/accept-review',
  validateJson(cellChangeReviewBody),
  async (c) => {
    try {
      const result = await acceptResearchCellChangeReview(
        c.var.userId,
        c.req.param('proposalId'),
        c.req.valid('json').expectedContentRevision,
      );
      return result
        ? c.json(result)
        : apiError(c, 'NOT_FOUND', m(c, 'researchCellChangeProposalNotFound'));
    } catch (error) {
      if (error instanceof ResearchCellChangeReviewUnavailableError) {
        return researchCellChangeReviewError(c, error);
      }
      throw error;
    }
  },
);

researchRoute.post(
  '/cell-change-proposals/:proposalId/revert-review',
  validateJson(cellChangeReviewBody),
  async (c) => {
    try {
      const result = await revertResearchCellChangeReview(
        c.var.userId,
        c.req.param('proposalId'),
        c.req.valid('json').expectedContentRevision,
      );
      return result
        ? c.json(result)
        : apiError(c, 'NOT_FOUND', m(c, 'researchCellChangeProposalNotFound'));
    } catch (error) {
      if (error instanceof ResearchCellChangeReviewUnavailableError) {
        return researchCellChangeReviewError(c, error);
      }
      throw error;
    }
  },
);

researchRoute.post('/cell-change-proposals/:proposalId/reject', async (c) => {
  const result = await rejectResearchCellChangeProposal(c.var.userId, c.req.param('proposalId'));
  return result
    ? c.json(result)
    : apiError(c, 'NOT_FOUND', m(c, 'researchCellChangeProposalNotFound'));
});

researchRoute.post('/cell-change-proposals/:proposalId/run-affected', async (c) => {
  try {
    const result = await runResearchCellChangeProposalAttempt(
      c.var.userId,
      c.req.param('proposalId'),
    );
    return result
      ? c.json(result)
      : apiError(c, 'NOT_FOUND', m(c, 'researchCellChangeProposalNotFound'));
  } catch (error) {
    if (error instanceof ResearchCellChangeReviewOpenError) {
      return apiError(c, 'CONFLICT', m(c, 'researchCellChangeReviewMustResolve'));
    }
    if (error instanceof ResearchDocumentRunInProgressError) {
      return apiError(c, 'CONFLICT', m(c, 'researchDocumentRunInProgress'));
    }
    if (error instanceof ResearchCellDependencyBlockedError) {
      return apiError(c, 'VALIDATION_FAILED', m(c, 'researchCellDependencyBlocked'), {
        cellIds: error.cellIds,
      });
    }
    if (error instanceof ResearchCellChangeAttemptUnavailableError) {
      const messageKey = {
        proposal_not_applied: 'researchCellChangeAttemptProposalNotApplied',
        proposal_revision_unavailable: 'researchCellChangeAttemptRevisionUnavailable',
        document_changed: 'researchCellChangeAttemptDocumentChanged',
        no_executable_cells: 'researchCellChangeAttemptNoExecutableCells',
      } as const;
      return apiError(
        c,
        error.reason === 'document_changed' ? 'CONFLICT' : 'VALIDATION_FAILED',
        m(c, messageKey[error.reason]),
        { reason: error.reason },
      );
    }
    throw error;
  }
});

researchRoute.post('/cells/:cellId/run', async (c) => {
  try {
    const document = await runResearchCell(c.var.userId, c.req.param('cellId'));
    return document ? c.json(document) : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
  } catch (error) {
    if (error instanceof ResearchCellChangeReviewOpenError) {
      return apiError(c, 'CONFLICT', m(c, 'researchCellChangeReviewMustResolve'));
    }
    if (error instanceof ResearchDocumentRunInProgressError) {
      return apiError(c, 'CONFLICT', m(c, 'researchDocumentRunInProgress'));
    }
    if (error instanceof ResearchCellDependencyBlockedError) {
      return apiError(c, 'VALIDATION_FAILED', m(c, 'researchCellDependencyBlocked'), {
        cellIds: error.cellIds,
      });
    }
    throw error;
  }
});

researchRoute.post('/cells/:cellId/run-affected', async (c) => {
  try {
    const result = await runAffectedResearchCells(c.var.userId, c.req.param('cellId'));
    return result ? c.json(result) : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
  } catch (error) {
    if (error instanceof ResearchCellChangeReviewOpenError) {
      return apiError(c, 'CONFLICT', m(c, 'researchCellChangeReviewMustResolve'));
    }
    if (error instanceof ResearchDocumentRunInProgressError) {
      return apiError(c, 'CONFLICT', m(c, 'researchDocumentRunInProgress'));
    }
    if (error instanceof ResearchCellDependencyBlockedError) {
      return apiError(c, 'VALIDATION_FAILED', m(c, 'researchCellDependencyBlocked'), {
        cellIds: error.cellIds,
      });
    }
    if (error instanceof ResearchAffectedRunError) {
      const messageKey =
        error.reason === 'duplicate_definitions'
          ? 'researchAffectedRunDuplicateDefinitions'
          : 'researchAffectedRunCyclicDependency';
      return apiError(c, 'VALIDATION_FAILED', m(c, messageKey), {
        reason: error.reason,
        ...(error.reason === 'duplicate_definitions'
          ? { conflicts: error.details }
          : { cellIds: error.details }),
      });
    }
    throw error;
  }
});

researchRoute.post('/documents/:documentId/analyze', async (c) => {
  const result = await analyzeResearchDocument(c.var.userId, c.req.param('documentId'));
  return result ? c.json(result) : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
});

researchRoute.post('/documents/:documentId/run', validateJson(runDocumentBody), async (c) => {
  try {
    const result = await runResearchDocument(
      c.var.userId,
      c.req.param('documentId'),
      c.req.valid('json').clean,
    );
    return result ? c.json(result) : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
  } catch (error) {
    if (error instanceof ResearchCellChangeReviewOpenError) {
      return apiError(c, 'CONFLICT', m(c, 'researchCellChangeReviewMustResolve'));
    }
    if (error instanceof ResearchDocumentRunInProgressError) {
      return apiError(c, 'CONFLICT', m(c, 'researchDocumentRunInProgress'));
    }
    if (error instanceof ResearchCellDependencyBlockedError) {
      return apiError(c, 'VALIDATION_FAILED', m(c, 'researchCellDependencyBlocked'), {
        cellIds: error.cellIds,
      });
    }
    throw error;
  }
});

researchRoute.post('/documents/:documentId/interrupt', async (c) => {
  const result = await interruptResearchDocument(c.var.userId, c.req.param('documentId'));
  return result ? c.json(result) : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
});

researchRoute.post('/documents/:documentId/reset', async (c) => {
  try {
    const document = await resetResearchDocumentRuntime(c.var.userId, c.req.param('documentId'));
    return document ? c.json(document) : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
  } catch (error) {
    if (error instanceof ResearchCellChangeReviewOpenError) {
      return apiError(c, 'CONFLICT', m(c, 'researchCellChangeReviewMustResolve'));
    }
    throw error;
  }
});

researchRoute.post('/curator/runs', async (c) =>
  c.json(await submitResearchCuratorRun(c.var.userId)),
);

researchRoute.get('/curator/runs/latest', async (c) =>
  c.json(await getLatestResearchCuratorRun(c.var.userId)),
);

researchRoute.get('/curator/runs/:runId', async (c) => {
  const run = await getResearchCuratorRun(c.var.userId, c.req.param('runId'));
  return run ? c.json(run) : apiError(c, 'NOT_FOUND', m(c, 'researchCuratorRunNotFound'));
});

researchRoute.patch(
  '/curator/findings/:findingId',
  validateJson(curatorFindingUpdateSchema),
  async (c) => {
    const input = c.req.valid('json');
    const finding = await updateResearchCuratorFindingFeedback(
      c.var.userId,
      c.req.param('findingId'),
      input,
    );
    return finding
      ? c.json(finding)
      : apiError(c, 'NOT_FOUND', m(c, 'researchCuratorFindingNotFound'));
  },
);

researchRoute.get('/conversations', async (c) =>
  c.json(await listResearchConversations(c.var.userId)),
);

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

researchRoute.post('/agent', validateJson(agentBody), async (c) => {
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

const renameBody = z.strictObject({ title: z.string().trim().min(1).max(120) });

researchRoute.patch('/conversations/:id', validateJson(renameBody), async (c) => {
  const updated = await renameResearchConversation(
    c.var.userId,
    c.req.param('id'),
    c.req.valid('json').title,
  );
  return updated
    ? c.json({ ok: true as const })
    : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
});

researchRoute.delete('/conversations/:id', async (c) => {
  const deleted = await deleteResearchConversation(c.var.userId, c.req.param('id'));
  return deleted
    ? c.json({ ok: true as const })
    : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
});

researchRoute.post('/universe/run', validateJson(universeSpecV1Schema), async (c) => {
  try {
    return c.json(await executeUniverseSpec(c.req.valid('json')));
  } catch (error) {
    return apiError(
      c,
      'VALIDATION_FAILED',
      error instanceof Error ? error.message : 'Universe execution failed.',
    );
  }
});

function researchCellChangeReviewError(
  c: Context,
  error: ResearchCellChangeReviewUnavailableError,
) {
  const messageKey = {
    delete_requires_explicit_application: 'researchCellChangeReviewDeleteRequiresApplication',
    review_not_open: 'researchCellChangeReviewNotOpen',
    review_already_open: 'researchCellChangeReviewAlreadyOpen',
    document_running: 'researchDocumentRunInProgress',
    document_changed: 'researchCellChangeReviewDocumentChanged',
  } as const;
  return apiError(
    c,
    error.reason === 'document_changed' || error.reason === 'document_running'
      ? 'CONFLICT'
      : 'VALIDATION_FAILED',
    m(c, messageKey[error.reason]),
    { reason: error.reason },
  );
}
