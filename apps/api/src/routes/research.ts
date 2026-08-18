import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';
import { apiError, validateJson, validateQuery } from '../lib/httpError.js';
import { initializeJobLogs } from '../lib/jobs.js';
import { wakeJobQueue } from '../lib/job-queue.js';
import { prisma } from '../lib/prisma.js';
import { researchProfile } from '../agent/profiles/research.js';
import { enqueueAgentTurn, entityKey } from '../agent/turn-run.js';
import * as turnBus from '../agent/turn-bus.js';
import { createProposeResearchCellChangesTool } from '../agent/tools/propose-research-cell-changes.js';
import { localeFromRequest, m } from '../i18n/index.js';
import { researchCapabilityCatalog } from '../research/catalog.js';
import {
  curatorFindingUpdateSchema,
  getLatestResearchCuratorRun,
  getResearchCuratorRun,
  updateResearchCuratorFindingFeedback,
} from '../research/curator.js';
import { executeResearchPlan } from '../research/executor.js';
import {
  createFailedResearchAttempt,
  createResearchRerun,
  listResearchStudyAttempts,
  listResearchStudyRuns,
} from '../research/records.js';
import { researchPlanSpecV1Schema } from '../research/spec.js';
import { universeSpecV1Schema } from '../research/spec.js';
import { executeUniverseSpec } from '../research/universe.js';
import { researchPythonLanguageService } from '../research/pyright-language-service.js';
import { searchResearchDataCatalog } from '../research/data-catalog.js';
import {
  applyResearchCellChangeProposal,
  rejectResearchCellChangeProposal,
} from '../research/workbench-cell-changes.js';
import {
  addResearchCell,
  analyzeResearchDocument,
  closeResearchDocumentRuntime,
  createResearchDocument,
  deleteResearchCell,
  getResearchDocument,
  interruptResearchDocument,
  listResearchDocuments,
  resetResearchDocumentRuntime,
  ResearchAffectedRunError,
  ResearchCellRevisionConflictError,
  ResearchDocumentRunInProgressError,
  runAffectedResearchCells,
  runResearchCell,
  runResearchDocument,
  updateResearchCell,
} from '../research/workbench.js';

/** Natural-language research workbench actions. Persistence and Agent turns join this route in M1. */
export const researchRoute = new Hono();

researchRoute.get('/catalog', (c) => c.json(researchCapabilityCatalog));

const dataCatalogQuery = z.strictObject({
  q: z.string().trim().max(120).default(''),
  assetType: z.enum(['stock', 'etf', 'index', 'future']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(24),
});

researchRoute.get('/data-catalog', validateQuery(dataCatalogQuery), async (c) => {
  const query = c.req.valid('query');
  return c.json(
    await searchResearchDataCatalog({
      query: query.q,
      assetType: query.assetType,
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
  kind: z.enum(['markdown', 'python', 'validation']),
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

researchRoute.get('/documents', async (c) => c.json(await listResearchDocuments(c.var.userId)));

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

researchRoute.post('/documents/:documentId/cells', validateJson(createCellBody), async (c) => {
  const { kind, source } = c.req.valid('json');
  const document = await addResearchCell(c.var.userId, c.req.param('documentId'), kind, source);
  return document ? c.json(document) : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
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
  const document = await deleteResearchCell(c.var.userId, c.req.param('cellId'));
  return document ? c.json(document) : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
});

researchRoute.post('/cell-change-proposals/:proposalId/apply', async (c) => {
  const result = await applyResearchCellChangeProposal(c.var.userId, c.req.param('proposalId'));
  return result
    ? c.json(result)
    : apiError(c, 'NOT_FOUND', m(c, 'researchCellChangeProposalNotFound'));
});

researchRoute.post('/cell-change-proposals/:proposalId/reject', async (c) => {
  const result = await rejectResearchCellChangeProposal(c.var.userId, c.req.param('proposalId'));
  return result
    ? c.json(result)
    : apiError(c, 'NOT_FOUND', m(c, 'researchCellChangeProposalNotFound'));
});

researchRoute.post('/cells/:cellId/run', async (c) => {
  try {
    const document = await runResearchCell(c.var.userId, c.req.param('cellId'));
    return document ? c.json(document) : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
  } catch (error) {
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
  const document = await resetResearchDocumentRuntime(c.var.userId, c.req.param('documentId'));
  return document ? c.json(document) : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
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

const agentBody = z.strictObject({
  conversationId: z.string().min(1).optional(),
  message: z.string().trim().min(1).max(2000),
});
const MAX_RESEARCH_AGENT_CONTEXT_CELLS = 100;
const MAX_RESEARCH_AGENT_SOURCE_CHARACTERS = 48_000;

researchRoute.post('/agent', validateJson(agentBody), async (c) => {
  const { message } = c.req.valid('json');
  const userId = c.var.userId;
  let conversationId = c.req.valid('json').conversationId;
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
        title: message.slice(0, 60),
      },
    });
  }
  const entity = { kind: 'research' as const, id: conversationId };
  if (turnBus.findRunning(entityKey(entity), userId)) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'conversationTurnInProgress'));
  }
  const document = await prisma.researchDocument.findUnique({
    where: { conversationId },
    select: {
      id: true,
      updatedAt: true,
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
    },
  });
  const turnId = ulid();
  const agentDocument = document ? researchAgentDocumentContext(document) : undefined;
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
          })
        : undefined,
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
      runtime: 'research-py-v1',
      cells: includedCells,
      cellsTruncated: document.cells.length > includedCells.length,
    }),
    editableCellIds,
  };
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

researchRoute.post('/run', validateJson(researchPlanSpecV1Schema), async (c) => {
  try {
    return c.json(await executeResearchPlan(c.req.valid('json')));
  } catch (error) {
    return apiError(
      c,
      'VALIDATION_FAILED',
      error instanceof Error ? error.message : 'Research plan failed.',
    );
  }
});

const rerunBody = z.strictObject({
  parentRunId: z.string().min(1),
  plan: researchPlanSpecV1Schema,
});

researchRoute.get('/studies/:studyId/runs', async (c) => {
  const records = await listResearchStudyRuns(c.var.userId, c.req.param('studyId'));
  return records ? c.json(records) : apiError(c, 'NOT_FOUND', m(c, 'researchStudyNotFound'));
});

researchRoute.get('/studies/:studyId/attempts', async (c) => {
  const attempts = await listResearchStudyAttempts(c.var.userId, c.req.param('studyId'));
  return attempts ? c.json(attempts) : apiError(c, 'NOT_FOUND', m(c, 'researchStudyNotFound'));
});

researchRoute.post('/studies/:studyId/runs', validateJson(rerunBody), async (c) => {
  const { parentRunId, plan } = c.req.valid('json');
  const studyId = c.req.param('studyId');
  const parent = await prisma.researchRun.findFirst({
    where: { id: parentRunId, studyId, study: { userId: c.var.userId, status: 'active' } },
    select: { id: true },
  });
  if (!parent) {
    return apiError(c, 'NOT_FOUND', m(c, 'researchStudyNotFound'));
  }
  try {
    const run = await executeResearchPlan(plan);
    const record = await createResearchRerun({
      userId: c.var.userId,
      studyId,
      parentRunId,
      run,
    });
    return record ? c.json(record) : apiError(c, 'NOT_FOUND', m(c, 'researchStudyNotFound'));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Research plan failed.';
    const attempt = await createFailedResearchAttempt({
      userId: c.var.userId,
      studyId,
      parentRunId,
      plan,
      error: message,
    });
    return apiError(c, 'VALIDATION_FAILED', message, attempt ? { attempt } : undefined);
  }
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
    (part): part is { type: 'research' | 'universe'; title: string } =>
      typeof part === 'object' &&
      part !== null &&
      ['research', 'universe'].includes((part as { type?: string }).type ?? '') &&
      typeof (part as { title?: unknown }).title === 'string',
  );
  return artifact?.title.slice(0, 80) ?? '';
}
