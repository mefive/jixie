import { Hono, type Context } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';
import type { ResearchClarificationV1 } from '@jixie/shared';
import { apiError, validateJson, validateQuery } from '../lib/httpError.js';
import { initializeJobLogs } from '../lib/jobs.js';
import { wakeJobQueue } from '../lib/job-queue.js';
import { prisma } from '../lib/prisma.js';
import { researchProfile } from '../agent/profiles/research.js';
import { enqueueAgentTurn, entityKey } from '../agent/turn-run.js';
import * as turnBus from '../agent/turn-bus.js';
import { createProposeResearchCellChangesTool } from '../agent/tools/propose-research-cell-changes.js';
import { createRequestResearchClarificationTool } from '../agent/tools/request-research-clarification.js';
import {
  createResearchCatalogTurnEvidence,
  createSearchResearchCatalogTool,
} from '../agent/tools/search-research-catalog.js';
import { localeFromRequest, m } from '../i18n/index.js';
import {
  curatorFindingUpdateSchema,
  getLatestResearchCuratorRun,
  getResearchCuratorRun,
  updateResearchCuratorFindingFeedback,
} from '../research/curator.js';
import { universeSpecV1Schema } from '../research/spec.js';
import { executeUniverseSpec } from '../research/universe.js';
import { researchPythonLanguageService } from '../research/pyright-language-service.js';
import { searchResearchDataCatalog } from '../research/data-catalog.js';
import {
  getResearchExecution,
  listResearchExecutions,
  promoteResearchExecution,
  ResearchExecutionPromotionUnavailableError,
} from '../research/research-execution-records.js';
import {
  ResearchClarificationAnswerError,
  resolveResearchClarificationAnswer,
} from '../research/research-clarification-records.js';
import {
  createResearchFactorDraft,
  ResearchFactorDraftUnavailableError,
} from '../research/research-factor-drafts.js';
import { ResearchFactorHandoffRejectedError } from '../research/research-factor-handoff.js';
import {
  createResearchStrategyDraft,
  ResearchStrategyDraftUnavailableError,
} from '../research/research-strategy-drafts.js';
import { ResearchStrategyHandoffRejectedError } from '../research/research-strategy-handoff.js';
import {
  acceptResearchCellChangeReview,
  applyResearchCellChangeProposal,
  applyResearchCellChangeProposalForReview,
  rejectResearchCellChangeProposal,
  ResearchCellChangeReviewUnavailableError,
  revertResearchCellChangeReview,
} from '../research/workbench-cell-changes.js';
import {
  ResearchCellChangeAttemptUnavailableError,
  runResearchCellChangeProposalAttempt,
} from '../research/workbench-cell-change-attempts.js';
import {
  addResearchCell,
  analyzeResearchDocument,
  archiveResearchDocument,
  closeResearchDocumentRuntime,
  createResearchDocument,
  deleteResearchCell,
  getResearchDocument,
  interruptResearchDocument,
  isResearchDocumentRunActive,
  listResearchDocuments,
  resetResearchDocumentRuntime,
  restoreResearchDocument,
  ResearchAffectedRunError,
  ResearchCellChangeReviewOpenError,
  ResearchCellRevisionConflictError,
  ResearchDocumentRunInProgressError,
  runAffectedResearchCells,
  runResearchCell,
  runResearchDocument,
  updateResearchCell,
} from '../research/workbench.js';

/** Natural-language research workbench actions. Persistence and Agent turns join this route in M1. */
export const researchRoute = new Hono();

const dataCatalogQuery = z.strictObject({
  q: z.string().trim().max(120).default(''),
  assetType: z.enum(['stock', 'etf', 'index', 'future']).optional(),
  scope: z.enum(['instruments', 'factor_reports']).default('instruments'),
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
  const artifact = await prisma.researchArtifact.findFirst({
    where: {
      id: c.req.param('artifactId'),
      document: { userId: c.var.userId },
    },
    select: { data: true, mimeType: true, byteSize: true, sha256: true },
  });
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
  template: z.enum(['blank', 'index_relationship']).default('blank'),
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

researchRoute.get('/documents/:documentId', async (c) => {
  const document = await getResearchDocument(c.var.userId, c.req.param('documentId'));
  return document ? c.json(document) : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
});

researchRoute.post('/documents/:documentId/archive', async (c) => {
  const documentId = c.req.param('documentId');
  const owner = await prisma.agentConversation.findFirst({
    where: { id: documentId, userId: c.var.userId, surface: 'research' },
    select: { id: true },
  });
  if (!owner) {
    return apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
  }
  if (
    isResearchDocumentRunActive(documentId) ||
    turnBus.findRunning(entityKey({ kind: 'research', id: documentId }), c.var.userId)
  ) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'researchDocumentRunInProgress'));
  }
  const archived = await archiveResearchDocument(c.var.userId, documentId);
  return archived
    ? c.json({ ok: true as const })
    : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
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

researchRoute.post('/curator/runs', async (c) => {
  const userId = c.var.userId;
  const active = await prisma.researchCuratorRun.findFirst({
    where: { userId, status: { in: ['queued', 'running'] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (active) {
    return c.json((await getResearchCuratorRun(userId, active.id))!);
  }
  const previous = await prisma.researchCuratorRun.findFirst({
    where: { userId, status: 'done' },
    orderBy: { cursorTo: 'desc' },
    select: { cursorTo: true },
  });
  const runId = ulid();
  const jobId = ulid();
  const cursorTo = new Date();
  await prisma.$transaction([
    prisma.researchCuratorRun.create({
      data: {
        id: runId,
        userId,
        trigger: 'manual',
        cursorFrom: previous?.cursorTo,
        cursorTo,
      },
    }),
    prisma.job.create({
      data: {
        id: jobId,
        userId,
        kind: 'research-curator',
        key: 'default',
        status: 'queued',
        payload: { runId },
        researchCuratorRunId: runId,
      },
    }),
  ]);
  initializeJobLogs(jobId);
  wakeJobQueue();
  return c.json((await getResearchCuratorRun(userId, runId))!);
});

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

researchRoute.get('/conversations', async (c) => {
  const conversations = await prisma.agentConversation.findMany({
    where: { userId: c.var.userId, surface: 'research', archivedAt: null },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      messages: {
        orderBy: { sequence: 'desc' },
        take: 1,
        select: { parts: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });
  return c.json(
    conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.title ?? '',
      preview: messagePreview(conversation.messages[0]?.parts),
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    })),
  );
});

const clarificationSelectionSchema = z.strictObject({
  questionId: z.string().min(1).max(80),
  selectedOptionIds: z.array(z.string().min(1).max(200)).max(4).default([]),
  customText: z.string().trim().min(1).max(500).optional(),
});
const agentBody = z
  .strictObject({
    conversationId: z.string().min(1).optional(),
    message: z.string().trim().min(1).max(2000).optional(),
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
  });
const MAX_RESEARCH_AGENT_CONTEXT_CELLS = 100;
const MAX_RESEARCH_AGENT_SOURCE_CHARACTERS = 48_000;
const MAX_RESEARCH_AGENT_ATTEMPT_CHARACTERS = 32_000;

researchRoute.post('/agent', validateJson(agentBody), async (c) => {
  const input = c.req.valid('json');
  const { attemptId, clarificationAnswer } = input;
  const userId = c.var.userId;
  let conversationId = input.conversationId;
  if (conversationId) {
    const existing = await prisma.agentConversation.findFirst({
      where: { id: conversationId, userId, surface: 'research', archivedAt: null },
      select: { id: true },
    });
    if (!existing) {
      return apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
    }
  } else {
    conversationId = ulid();
    await prisma.agentConversation.create({
      data: {
        id: conversationId,
        userId,
        surface: 'research',
        title: input.message!.slice(0, 60),
      },
    });
  }
  const entity = { kind: 'research' as const, id: conversationId };
  if (turnBus.findRunning(entityKey(entity), userId)) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'conversationTurnInProgress'));
  }
  let message = input.message ?? '';
  if (clarificationAnswer) {
    try {
      const clarification = await resolveResearchClarificationAnswer(
        userId,
        conversationId,
        clarificationAnswer.clarificationId,
        clarificationAnswer.selections,
      );
      message = researchClarificationAnswerMessage(c, clarification);
    } catch (error) {
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
  }
  const document = await prisma.researchDocument.findUnique({
    where: { conversationId },
    select: {
      id: true,
      updatedAt: true,
      contentRevision: true,
      cells: {
        orderBy: { position: 'asc' },
        select: {
          id: true,
          position: true,
          kind: true,
          source: true,
          status: true,
          revision: true,
          definitions: true,
          references: true,
          output: true,
        },
      },
      clarifications: {
        where: { status: 'pending' },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!clarificationAnswer && document?.clarifications.length) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'researchClarificationPending'));
  }
  const attempt = attemptId
    ? await prisma.researchCellChangeAttempt.findFirst({
        where: {
          id: attemptId,
          document: { conversationId, userId },
          status: { in: ['success', 'error', 'cancelled'] },
        },
        include: {
          executions: {
            orderBy: { startedAt: 'asc' },
            include: { cell: { select: { kind: true, position: true } } },
          },
        },
      })
    : null;
  if (attemptId && !attempt) {
    return apiError(c, 'NOT_FOUND', m(c, 'researchCellChangeAttemptNotFound'));
  }
  const turnId = ulid();
  const agentDocument = document ? researchAgentDocumentContext(document) : undefined;
  const catalogEvidence = createResearchCatalogTurnEvidence();
  const catalogTool = createSearchResearchCatalogTool(catalogEvidence);
  if (attempt) {
    await prisma.researchCellChangeAttempt.update({
      where: { id: attempt.id },
      data: { explanationTurnId: turnId },
    });
  }
  enqueueAgentTurn({
    turnId,
    userId,
    profile: researchProfile(
      agentDocument?.context,
      document
        ? createProposeResearchCellChangesTool({
            userId,
            documentId: document.id,
            editableCellIds: agentDocument!.editableCellIds,
            catalogEvidence,
          })
        : undefined,
      attempt ? researchAgentCellChangeAttemptContext(attempt) : undefined,
      document
        ? createRequestResearchClarificationTool({ documentId: document.id, catalogEvidence })
        : undefined,
      catalogTool,
    ),
    entity,
    message,
    currentCode: '',
    locale: localeFromRequest(c),
  });
  return c.json({ conversationId, turnId });
});

function researchAgentDocumentContext(document: {
  id: string;
  updatedAt: Date;
  contentRevision: number;
  cells: Array<{
    id: string;
    position: number;
    kind: string;
    source: string;
    status: string;
    revision: number;
    definitions: unknown;
    references: unknown;
    output: unknown;
  }>;
}): { context: string; editableCellIds: Set<string> } {
  let remainingSourceCharacters = MAX_RESEARCH_AGENT_SOURCE_CHARACTERS;
  const editableCellIds = new Set<string>();
  const includedCells = document.cells.slice(0, MAX_RESEARCH_AGENT_CONTEXT_CELLS).map((cell) => {
    const sourceCharacters = Math.min(remainingSourceCharacters, cell.source.length);
    const source = cell.source.slice(0, sourceCharacters);
    const sourceTruncated = source.length !== cell.source.length;
    remainingSourceCharacters -= sourceCharacters;
    if (!sourceTruncated) {
      editableCellIds.add(cell.id);
    }
    return {
      id: cell.id,
      position: cell.position,
      kind: cell.kind,
      status: cell.status,
      revision: cell.revision,
      definitions: Array.isArray(cell.definitions) ? cell.definitions : [],
      references: Array.isArray(cell.references) ? cell.references : [],
      outputTypes: Array.isArray(cell.output)
        ? cell.output
            .map((output) =>
              output && typeof output === 'object' && 'type' in output
                ? String(output.type)
                : 'unknown',
            )
            .slice(0, 20)
        : [],
      source,
      sourceTruncated,
    };
  });
  return {
    context: JSON.stringify({
      version: 1,
      documentId: document.id,
      updatedAt: document.updatedAt.toISOString(),
      contentRevision: document.contentRevision,
      runtime: 'research-py-v1',
      cells: includedCells,
      cellsTruncated: document.cells.length > includedCells.length,
    }),
    editableCellIds,
  };
}

function researchAgentCellChangeAttemptContext(attempt: {
  id: string;
  proposalId: string;
  contentRevision: number;
  scope: string;
  status: string;
  rootCellIds: unknown;
  plannedCellIds: unknown;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  executions: Array<{
    id: string;
    cellId: string | null;
    sourceCellId: string | null;
    sourcePosition: number | null;
    sourceKind: string | null;
    revision: number;
    source: string;
    status: string;
    output: unknown;
    error: string | null;
    environmentFingerprint: string;
    cell: { kind: string; position: number } | null;
  }>;
}): string {
  let remainingCharacters = MAX_RESEARCH_AGENT_ATTEMPT_CHARACTERS;
  const executions = attempt.executions.map((execution) => {
    const sourceCharacters = Math.min(4_000, remainingCharacters, execution.source.length);
    const source = execution.source.slice(0, sourceCharacters);
    remainingCharacters -= sourceCharacters;

    const serializedOutput = JSON.stringify(execution.output ?? null);
    const outputCharacters = Math.min(6_000, remainingCharacters, serializedOutput.length);
    const outputText = serializedOutput.slice(0, outputCharacters);
    remainingCharacters -= outputCharacters;
    return {
      executionId: execution.id,
      cellId: execution.sourceCellId ?? execution.cellId,
      position: execution.sourcePosition ?? execution.cell?.position,
      kind: execution.sourceKind ?? execution.cell?.kind,
      revision: execution.revision,
      status: execution.status,
      source,
      sourceTruncated: source.length !== execution.source.length,
      output:
        outputText.length === serializedOutput.length
          ? JSON.parse(outputText)
          : { jsonPrefix: outputText, truncated: true },
      ...(execution.error ? { error: execution.error } : {}),
      environmentFingerprint: execution.environmentFingerprint,
    };
  });
  return JSON.stringify({
    version: 1,
    attemptId: attempt.id,
    proposalId: attempt.proposalId,
    contentRevision: attempt.contentRevision,
    scope: attempt.scope,
    status: attempt.status,
    rootCellIds: attempt.rootCellIds,
    plannedCellIds: attempt.plannedCellIds,
    executions,
    ...(attempt.error ? { error: attempt.error } : {}),
    startedAt: attempt.startedAt.toISOString(),
    ...(attempt.finishedAt ? { finishedAt: attempt.finishedAt.toISOString() } : {}),
  });
}

const renameBody = z.strictObject({ title: z.string().trim().min(1).max(120) });

researchRoute.patch('/conversations/:id', validateJson(renameBody), async (c) => {
  const updated = await prisma.agentConversation.updateMany({
    where: {
      id: c.req.param('id'),
      userId: c.var.userId,
      surface: 'research',
      archivedAt: null,
    },
    data: { title: c.req.valid('json').title },
  });
  return updated.count === 1
    ? c.json({ ok: true as const })
    : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
});

researchRoute.delete('/conversations/:id', async (c) => {
  const conversationId = c.req.param('id');
  const deleted = await prisma.agentConversation.deleteMany({
    where: { id: conversationId, userId: c.var.userId, surface: 'research' },
  });
  if (deleted.count === 1) {
    closeResearchDocumentRuntime(conversationId);
  }
  return deleted.count === 1
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

function messagePreview(parts: unknown): string {
  if (!Array.isArray(parts)) {
    return '';
  }
  const text = parts.find(
    (part): part is { type: 'text'; text: string } =>
      typeof part === 'object' &&
      part !== null &&
      (part as { type?: unknown }).type === 'text' &&
      typeof (part as { text?: unknown }).text === 'string',
  );
  if (text) {
    return text.text.slice(0, 80);
  }
  const artifact = parts.find(
    (part): part is { type: 'universe'; title: string } =>
      typeof part === 'object' &&
      part !== null &&
      (part as { type?: string }).type === 'universe' &&
      typeof (part as { title?: unknown }).title === 'string',
  );
  return artifact?.title.slice(0, 80) ?? '';
}

function researchClarificationAnswerMessage(
  c: Context,
  clarification: ResearchClarificationV1,
): string {
  const locale = localeFromRequest(c);
  const selections = clarification.answer?.selections.flatMap((selection) => {
    const question = clarification.questions.find(
      (candidate) => candidate.id === selection.questionId,
    );
    if (!question) {
      return [];
    }
    const labels = selection.selectedOptionIds.flatMap((optionId) => {
      const option = question.options.find((candidate) => candidate.id === optionId);
      return option ? [locale === 'zh' ? option.labelZh : option.labelEn] : [];
    });
    if (selection.customText) {
      labels.push(selection.customText);
    }
    return labels;
  });
  return m(c, 'researchClarificationAnswerMessage', {
    selections: selections?.join(locale === 'zh' ? '；' : '; ') || '-',
  });
}

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
