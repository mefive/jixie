import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Prisma, PrismaClient } from '@prisma/client';
import prismaPackage from '@prisma/client';
import type {
  AgentTurnTrace,
  MessagePart,
  ResearchPlanSpecV1,
  ResearchRunResultV1,
} from '@jixie/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  compareResearchPlans,
  compareResearchRunRows,
  createFailedResearchAttempt,
  createResearchRerun,
  listResearchStudyAttempts,
  listResearchStudyRuns,
  migrateResearchRecords,
  persistFailedResearchAttempts,
  persistResearchMessageParts,
} from './records.js';
import { researchPayloadHash } from './fingerprints.js';

const { PrismaClient: RuntimePrismaClient } = prismaPackage;

describe('research records', () => {
  let temporaryDirectory: string;
  let database: PrismaClient;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'jixie-research-records-'));
    database = new RuntimePrismaClient({
      datasourceUrl: `file:${join(temporaryDirectory, 'records.db')}`,
    });
    await createFixtureSchema(database);
  });

  afterEach(async () => {
    await database.$disconnect();
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('backfills chat artifacts once and attaches stable record references', async () => {
    await seedResearchMessage(database, sampleRun());

    await expect(migrateResearchRecords(database)).resolves.toEqual({
      messagesScanned: 1,
      messagesUpdated: 1,
      studiesCreated: 1,
      runsCreated: 1,
      runsUpdated: 0,
      attemptsCreated: 0,
    });
    await expect(migrateResearchRecords(database)).resolves.toEqual({
      messagesScanned: 1,
      messagesUpdated: 0,
      studiesCreated: 0,
      runsCreated: 0,
      runsUpdated: 0,
      attemptsCreated: 0,
    });

    const message = await database.agentMessage.findUniqueOrThrow({ where: { id: 'message-a' } });
    const part = (message.parts as unknown as MessagePart[])[0];
    expect(part).toMatchObject({
      type: 'research',
      record: { version: 1, sequence: 1 },
    });
    expect(await database.researchStudy.count()).toBe(1);
    expect(await database.researchRun.count()).toBe(1);
  });

  it('backfills failed Agent attempts from durable turn traces idempotently', async () => {
    await seedResearchMessage(database, sampleRun());
    await database.agentTurn.update({
      where: { id: 'turn-a' },
      data: {
        trace: {
          version: 1,
          truncated: false,
          steps: [
            {
              id: 'migration-failed-step',
              sequence: 0,
              createdAt: '2026-08-14T03:00:00.000Z',
              type: 'tool',
              toolCallId: 'migration-call',
              name: 'executeResearchPlan',
              arguments: JSON.stringify({ plan: validPlan() }),
              observation: 'Tool execution failed: Insufficient observations.',
              ok: false,
              durationMs: 12,
            },
          ],
        },
      },
    });

    await expect(migrateResearchRecords(database)).resolves.toMatchObject({
      studiesCreated: 1,
      runsCreated: 1,
      attemptsCreated: 1,
    });
    await expect(migrateResearchRecords(database)).resolves.toMatchObject({
      studiesCreated: 0,
      runsCreated: 0,
      attemptsCreated: 0,
    });
    expect(await database.researchAttempt.count()).toBe(1);
  });

  it('materializes a Cell change proposal only beside its committed assistant message', async () => {
    await seedResearchMessage(database, sampleRun());
    const expectedDocumentUpdatedAt = new Date('2026-08-18T08:00:00.000Z');
    await database.researchDocument.create({
      data: {
        id: 'document-a',
        userId: 'user-a',
        conversationId: 'conversation-a',
        updatedAt: expectedDocumentUpdatedAt,
      },
    });
    await database.agentTurn.create({
      data: {
        id: 'turn-proposal',
        conversationId: 'conversation-a',
        status: 'done',
        model: 'test',
        trace: {},
      },
    });
    await database.agentMessage.create({
      data: {
        id: 'message-proposal',
        conversationId: 'conversation-a',
        role: 'assistant',
        parts: [],
        sequence: 1,
        turnId: 'turn-proposal',
      },
    });
    const proposal = {
      version: 1 as const,
      id: 'proposal-a',
      documentId: 'document-a',
      title: 'Add one Cell',
      summary: 'Add a review-only Python Cell.',
      status: 'pending' as const,
      expectedDocumentUpdatedAt: expectedDocumentUpdatedAt.toISOString(),
      expectedDocumentContentRevision: 1,
      operations: [
        {
          operationId: 'operation-a',
          cellId: 'cell-a',
          kind: 'create' as const,
          cellKind: 'python' as const,
          position: 0,
          beforeSource: '' as const,
          afterSource: 'result = 1',
          addedLines: 1,
          removedLines: 0,
          afterDefinitions: ['result'],
          afterReferences: [],
        },
      ],
      createdAt: '2026-08-18T08:01:00.000Z',
    };

    const persisted = await database.$transaction((transaction) =>
      persistResearchMessageParts(transaction, {
        conversationId: 'conversation-a',
        messageId: 'message-proposal',
        turnId: 'turn-proposal',
        userId: 'user-a',
        parts: [
          { type: 'text', text: 'Prepared for review.' },
          { type: 'research_cell_change', proposal },
        ],
      }),
    );

    expect(persisted[1]).toEqual({ type: 'research_cell_change', proposal });
    expect(
      await database.researchCellChangeProposal.findUniqueOrThrow({ where: { id: proposal.id } }),
    ).toMatchObject({
      sourceTurnId: 'turn-proposal',
      sourceMessageId: 'message-proposal',
      sourcePartIndex: 1,
      status: 'pending',
    });
  });

  it('stores immutable parameter reruns in one ordered study', async () => {
    await seedResearchMessage(database, sampleRun());
    await migrateResearchRecords(database);
    const first = await database.researchRun.findFirstOrThrow();
    const nextRun = sampleRun(24, 1);

    const created = await createResearchRerun(
      { userId: 'user-a', studyId: first.studyId, parentRunId: first.id, run: nextRun },
      database,
    );
    expect(created).toMatchObject({
      origin: 'parameter_rerun',
      parentRunId: first.id,
      ref: { sequence: 2 },
      run: { result: { observations: 24 } },
      comparisonToParent: {
        changes: ['parameters'],
        resultChanged: true,
        attribution: 'parameters',
      },
    });
    await expect(listResearchStudyRuns('user-a', first.studyId, database)).resolves.toHaveLength(2);
    await expect(listResearchStudyRuns('user-b', first.studyId, database)).resolves.toBeNull();
  });

  it('retains failed parameter reruns beside successful history', async () => {
    await seedResearchMessage(database, sampleRun());
    await migrateResearchRecords(database);
    const first = await database.researchRun.findFirstOrThrow();
    const failed = await createFailedResearchAttempt(
      {
        userId: 'user-a',
        studyId: first.studyId,
        parentRunId: first.id,
        plan: sampleRun(12, 2).plan,
        error: 'Insufficient aligned observations.',
      },
      database,
    );

    expect(failed).toMatchObject({
      origin: 'parameter_rerun',
      parentRunId: first.id,
      error: 'Insufficient aligned observations.',
      planChanges: [{ path: 'protocol.predictorLag', before: '0', after: '2' }],
    });
    await expect(
      listResearchStudyAttempts('user-a', first.studyId, database),
    ).resolves.toHaveLength(1);
    await expect(listResearchStudyAttempts('user-b', first.studyId, database)).resolves.toBeNull();
  });

  it('normalizes failed Agent tool calls once and links them to the recovered Study', async () => {
    await seedResearchMessage(database, sampleRun());
    await migrateResearchRecords(database);
    const first = await database.researchRun.findFirstOrThrow();
    const trace: AgentTurnTrace = {
      version: 1,
      truncated: false,
      steps: [
        {
          id: 'failed-step-a',
          sequence: 0,
          createdAt: '2026-08-14T03:00:00.000Z',
          type: 'tool',
          toolCallId: 'call-a',
          name: 'executeResearchPlan',
          arguments: JSON.stringify({ plan: validPlan() }),
          observation: 'Tool execution failed: Insufficient observations.',
          ok: false,
          durationMs: 12,
        },
      ],
    };

    await expect(
      database.$transaction((transaction) =>
        persistFailedResearchAttempts(transaction, {
          conversationId: 'conversation-a',
          turnId: 'turn-a',
          userId: 'user-a',
          trace,
        }),
      ),
    ).resolves.toBe(1);
    await expect(
      database.$transaction((transaction) =>
        persistFailedResearchAttempts(transaction, {
          conversationId: 'conversation-a',
          turnId: 'turn-a',
          userId: 'user-a',
          trace,
        }),
      ),
    ).resolves.toBe(0);
    await expect(listResearchStudyAttempts('user-a', first.studyId, database)).resolves.toEqual([
      expect.objectContaining({
        origin: 'agent',
        studyId: first.studyId,
        error: 'Insufficient observations.',
        createdAt: '2026-08-14T03:00:00.000Z',
      }),
    ]);
  });

  it('keeps an all-failed Study open and reuses it after a later successful correction', async () => {
    await database.user.create({ data: { id: 'user-a', email: 'a@example.com' } });
    await database.agentConversation.create({
      data: { id: 'conversation-a', userId: 'user-a', surface: 'research', title: 'Study' },
    });
    await database.agentTurn.create({
      data: {
        id: 'turn-failed',
        conversationId: 'conversation-a',
        status: 'done',
        model: 'test',
        trace: {},
      },
    });
    const failedTrace: AgentTurnTrace = {
      version: 1,
      truncated: false,
      steps: [
        {
          id: 'failed-step-only',
          sequence: 0,
          createdAt: '2026-08-14T03:00:00.000Z',
          type: 'tool',
          toolCallId: 'call-only',
          name: 'executeResearchPlan',
          arguments: JSON.stringify({ plan: validPlan() }),
          observation: 'Tool execution failed: Insufficient observations.',
          ok: false,
          durationMs: 12,
        },
      ],
    };
    await database.$transaction((transaction) =>
      persistFailedResearchAttempts(transaction, {
        conversationId: 'conversation-a',
        turnId: 'turn-failed',
        userId: 'user-a',
        trace: failedTrace,
      }),
    );
    const failedStudy = await database.researchStudy.findFirstOrThrow();
    expect(await database.researchRun.count()).toBe(0);

    await database.agentTurn.create({
      data: {
        id: 'turn-success',
        conversationId: 'conversation-a',
        status: 'done',
        model: 'test',
        trace: {},
      },
    });
    await database.agentMessage.create({
      data: {
        id: 'message-success',
        conversationId: 'conversation-a',
        role: 'assistant',
        parts: [],
        sequence: 0,
        turnId: 'turn-success',
      },
    });
    await database.$transaction((transaction) =>
      persistResearchMessageParts(transaction, {
        conversationId: 'conversation-a',
        messageId: 'message-success',
        turnId: 'turn-success',
        userId: 'user-a',
        parts: [{ type: 'research', title: 'Study', run: sampleRun() }],
      }),
    );

    expect(await database.researchStudy.count()).toBe(1);
    expect(await database.researchRun.findFirstOrThrow()).toMatchObject({
      studyId: failedStudy.id,
      sequence: 1,
    });
    expect(await database.researchAttempt.findFirstOrThrow()).toMatchObject({
      studyId: failedStudy.id,
    });
  });

  it('hashes equivalent payloads independently of object key order', () => {
    expect(researchPayloadHash({ b: 2, a: { d: 4, c: 3 } })).toBe(
      researchPayloadHash({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });

  it('attributes run changes without asking the model to infer their cause', async () => {
    await seedResearchMessage(database, sampleRun());
    await migrateResearchRecords(database);
    const base = await database.researchRun.findFirstOrThrow();
    const candidate = { ...base, id: 'candidate', parentRunId: base.id };

    expect(
      compareResearchRunRows(base, {
        ...candidate,
        plan: { ...(base.plan as object), protocol: { predictorLag: 1 } },
        planHash: 'changed-plan',
      }),
    ).toMatchObject({
      changes: ['parameters'],
      planChanges: [{ path: 'protocol.predictorLag', before: '0', after: '1' }],
      planChangesTruncated: false,
      resultChanged: false,
      attribution: 'parameters',
    });
    expect(
      compareResearchRunRows(base, {
        ...candidate,
        dataFingerprint: 'changed-data',
        resultHash: 'changed-result',
      }),
    ).toMatchObject({ changes: ['data'], resultChanged: true, attribution: 'data' });
    expect(
      compareResearchRunRows(base, {
        ...candidate,
        protocolVersion: 2,
        plan: { ...(base.plan as object), protocol: { predictorLag: 0, version: 2 } },
        planHash: 'changed-plan',
        resultHash: 'changed-result',
      }),
    ).toMatchObject({ changes: ['protocol'], resultChanged: true, attribution: 'protocol' });
    expect(
      compareResearchRunRows(base, {
        ...candidate,
        protocolFingerprint: 'changed-implementation',
        environmentFingerprint: 'changed-environment',
        resultHash: 'changed-result',
      }),
    ).toMatchObject({
      changes: ['implementation', 'environment'],
      resultChanged: true,
      attribution: 'multiple',
    });
    expect(
      compareResearchRunRows(
        { ...base, dataFingerprint: null },
        { ...candidate, resultHash: 'changed-result' },
      ),
    ).toMatchObject({ changes: [], resultChanged: true, attribution: 'unavailable' });
  });

  it('summarizes stable-id plan arrays and caps very large alternative specifications', () => {
    expect(
      compareResearchPlans(
        { inputs: [{ id: 'series-a', transform: 'level' }], protocol: { version: 1 } },
        { inputs: [{ id: 'series-a', transform: 'simple_return' }], protocol: { version: 2 } },
      ),
    ).toEqual({
      changes: [
        { path: 'inputs[series-a].transform', before: '"level"', after: '"simple_return"' },
        { path: 'protocol.version', before: '1', after: '2' },
      ],
      truncated: false,
    });
    expect(compareResearchPlans({ a: 1, b: 2 }, { a: 2, b: 3 }, 1)).toEqual({
      changes: [{ path: 'a', before: '1', after: '2' }],
      truncated: true,
    });
  });
});

function validPlan(): ResearchPlanSpecV1 {
  return {
    version: 1,
    question: {
      version: 1,
      kind: 'time_series_relationship',
      text: 'Test relationship',
      hypothesis: { estimand: 'regression_slope', direction: 'two_sided', nullValue: 0 },
    },
    start: '20200101',
    end: '20251231',
    inputs: [
      {
        type: 'series',
        id: 'predictor',
        source: { kind: 'instrument', assetType: 'index', id: '000300.SH' },
        measure: 'market.adjusted_close',
        transform: 'simple_return',
      },
      {
        type: 'series',
        id: 'outcome',
        source: { kind: 'instrument', assetType: 'index', id: '000905.SH' },
        measure: 'market.adjusted_close',
        transform: 'simple_return',
      },
    ],
    alignment: { frequency: 'monthly', join: 'inner', partialPeriod: 'exclude' },
    protocol: {
      kind: 'time_series_relationship',
      version: 1,
      predictor: 'predictor',
      outcome: 'outcome',
      predictorLag: 0,
      correlations: ['pearson', 'spearman'],
      inference: { kind: 'newey_west', lag: 'automatic' },
      rollingWindow: 24,
    },
    outputs: [{ kind: 'summary_table' }, { kind: 'conclusion' }],
  };
}

function sampleRun(observations = 12, predictorLag = 0): ResearchRunResultV1 {
  return {
    version: 1,
    plan: {
      version: 1,
      question: {
        version: 1,
        kind: 'time_series_relationship',
        text: 'Test relationship',
        hypothesis: { estimand: 'regression_slope', direction: 'two_sided', nullValue: 0 },
      },
      protocol: { predictorLag },
    },
    protocol: { id: 'time_series_relationship', version: 1 },
    result: { kind: 'time_series_relationship', observations },
    coverage: [],
    conclusion: { level: 'indeterminate' },
    diagnostics: [],
    fingerprints: {
      version: 1,
      protocol: {
        id: 'time_series_relationship',
        version: 1,
        appRevision: 'test-revision',
        implementationHash: 'implementation-a',
      },
      data: { hash: 'data-a', inputs: [] },
      environment: {
        hash: 'environment-a',
        nodeVersion: 'v22.0.0',
        platform: 'test',
        architecture: 'test',
      },
    },
  } as unknown as ResearchRunResultV1;
}

async function seedResearchMessage(database: PrismaClient, run: ResearchRunResultV1) {
  await database.user.create({ data: { id: 'user-a', email: 'a@example.com' } });
  await database.agentConversation.create({
    data: {
      id: 'conversation-a',
      userId: 'user-a',
      surface: 'research',
      title: 'Study',
    },
  });
  await database.agentTurn.create({
    data: {
      id: 'turn-a',
      conversationId: 'conversation-a',
      status: 'done',
      model: 'test',
      trace: {},
    },
  });
  await database.agentMessage.create({
    data: {
      id: 'message-a',
      conversationId: 'conversation-a',
      role: 'assistant',
      parts: [{ type: 'research', title: 'Study', run }] as unknown as Prisma.InputJsonValue,
      sequence: 0,
      turnId: 'turn-a',
    },
  });
}

async function createFixtureSchema(database: PrismaClient) {
  const statements = [
    'PRAGMA foreign_keys=ON',
    'CREATE TABLE "User" ("id" TEXT NOT NULL PRIMARY KEY, "email" TEXT NOT NULL, "name" TEXT, "status" TEXT NOT NULL DEFAULT \'active\', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE "AgentConversation" ("id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "surface" TEXT NOT NULL, "title" TEXT, "strategyId" TEXT, "factorId" TEXT, "archivedAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE)',
    'CREATE TABLE "AgentTurn" ("id" TEXT NOT NULL PRIMARY KEY, "conversationId" TEXT NOT NULL, "status" TEXT NOT NULL, "model" TEXT NOT NULL, "trace" JSONB NOT NULL, "error" TEXT, "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "finishedAt" DATETIME, FOREIGN KEY ("conversationId") REFERENCES "AgentConversation"("id") ON DELETE CASCADE)',
    'CREATE TABLE "AgentMessage" ("id" TEXT NOT NULL PRIMARY KEY, "conversationId" TEXT NOT NULL, "role" TEXT NOT NULL, "parts" JSONB NOT NULL, "sequence" INTEGER NOT NULL, "turnId" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY ("conversationId") REFERENCES "AgentConversation"("id") ON DELETE CASCADE, FOREIGN KEY ("turnId") REFERENCES "AgentTurn"("id") ON DELETE SET NULL)',
    'CREATE TABLE "ResearchDocument" ("id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "conversationId" TEXT NOT NULL, "runtimeVersion" TEXT NOT NULL DEFAULT \'research-py-v1\', "contentRevision" INTEGER NOT NULL DEFAULT 1, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE, FOREIGN KEY ("conversationId") REFERENCES "AgentConversation"("id") ON DELETE CASCADE)',
    'CREATE TABLE "ResearchCellChangeProposal" ("id" TEXT NOT NULL PRIMARY KEY, "documentId" TEXT NOT NULL, "sourceTurnId" TEXT NOT NULL, "sourceMessageId" TEXT NOT NULL, "sourcePartIndex" INTEGER NOT NULL, "title" TEXT NOT NULL, "summary" TEXT NOT NULL, "expectedDocumentUpdatedAt" DATETIME NOT NULL, "expectedDocumentContentRevision" INTEGER, "operations" JSONB NOT NULL, "status" TEXT NOT NULL DEFAULT \'pending\', "conflict" JSONB, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "resolvedAt" DATETIME, FOREIGN KEY ("documentId") REFERENCES "ResearchDocument"("id") ON DELETE CASCADE, FOREIGN KEY ("sourceTurnId") REFERENCES "AgentTurn"("id") ON DELETE CASCADE, FOREIGN KEY ("sourceMessageId") REFERENCES "AgentMessage"("id") ON DELETE CASCADE)',
    'CREATE TABLE "ResearchStudy" ("id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "conversationId" TEXT NOT NULL, "title" TEXT NOT NULL, "question" JSONB NOT NULL, "status" TEXT NOT NULL DEFAULT \'active\', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE, FOREIGN KEY ("conversationId") REFERENCES "AgentConversation"("id") ON DELETE CASCADE)',
    'CREATE TABLE "ResearchRun" ("id" TEXT NOT NULL PRIMARY KEY, "studyId" TEXT NOT NULL, "parentRunId" TEXT, "sourceTurnId" TEXT, "sourceMessageId" TEXT, "sourcePartIndex" INTEGER, "sequence" INTEGER NOT NULL, "origin" TEXT NOT NULL, "protocolId" TEXT NOT NULL, "protocolVersion" INTEGER NOT NULL, "plan" JSONB NOT NULL, "result" JSONB NOT NULL, "planHash" TEXT NOT NULL, "resultHash" TEXT NOT NULL, "protocolFingerprint" TEXT, "dataFingerprint" TEXT, "environmentFingerprint" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY ("studyId") REFERENCES "ResearchStudy"("id") ON DELETE CASCADE, FOREIGN KEY ("parentRunId") REFERENCES "ResearchRun"("id") ON DELETE SET NULL, FOREIGN KEY ("sourceTurnId") REFERENCES "AgentTurn"("id") ON DELETE SET NULL, FOREIGN KEY ("sourceMessageId") REFERENCES "AgentMessage"("id") ON DELETE SET NULL)',
    'CREATE TABLE "ResearchAttempt" ("id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "conversationId" TEXT NOT NULL, "studyId" TEXT, "parentRunId" TEXT, "sourceTurnId" TEXT, "sourceStepId" TEXT, "origin" TEXT NOT NULL, "plan" JSONB, "planHash" TEXT, "arguments" TEXT NOT NULL, "error" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE, FOREIGN KEY ("conversationId") REFERENCES "AgentConversation"("id") ON DELETE CASCADE, FOREIGN KEY ("studyId") REFERENCES "ResearchStudy"("id") ON DELETE CASCADE, FOREIGN KEY ("parentRunId") REFERENCES "ResearchRun"("id") ON DELETE SET NULL, FOREIGN KEY ("sourceTurnId") REFERENCES "AgentTurn"("id") ON DELETE SET NULL)',
    'CREATE UNIQUE INDEX "User_email_key" ON "User"("email")',
    'CREATE UNIQUE INDEX "AgentMessage_conversationId_sequence_key" ON "AgentMessage"("conversationId", "sequence")',
    'CREATE UNIQUE INDEX "ResearchDocument_conversationId_key" ON "ResearchDocument"("conversationId")',
    'CREATE UNIQUE INDEX "ResearchCellChangeProposal_sourceMessageId_sourcePartIndex_key" ON "ResearchCellChangeProposal"("sourceMessageId", "sourcePartIndex")',
    'CREATE UNIQUE INDEX "ResearchRun_studyId_sequence_key" ON "ResearchRun"("studyId", "sequence")',
    'CREATE UNIQUE INDEX "ResearchRun_sourceMessageId_sourcePartIndex_key" ON "ResearchRun"("sourceMessageId", "sourcePartIndex")',
    'CREATE UNIQUE INDEX "ResearchAttempt_sourceStepId_key" ON "ResearchAttempt"("sourceStepId")',
  ];
  for (const statement of statements) {
    await database.$executeRawUnsafe(statement);
  }
}
