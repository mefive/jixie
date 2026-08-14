import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Prisma, PrismaClient } from '@prisma/client';
import prismaPackage from '@prisma/client';
import type { MessagePart, ResearchRunResultV1 } from '@jixie/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createResearchRerun,
  listResearchStudyRuns,
  migrateResearchRecords,
  researchPayloadHash,
} from './records.js';

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
    });
    await expect(migrateResearchRecords(database)).resolves.toEqual({
      messagesScanned: 1,
      messagesUpdated: 0,
      studiesCreated: 0,
      runsCreated: 0,
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

  it('stores immutable parameter reruns in one ordered study', async () => {
    await seedResearchMessage(database, sampleRun());
    await migrateResearchRecords(database);
    const first = await database.researchRun.findFirstOrThrow();
    const nextRun = sampleRun(24);

    const created = await createResearchRerun(
      { userId: 'user-a', studyId: first.studyId, parentRunId: first.id, run: nextRun },
      database,
    );
    expect(created).toMatchObject({
      origin: 'parameter_rerun',
      parentRunId: first.id,
      ref: { sequence: 2 },
      run: { result: { observations: 24 } },
    });
    await expect(listResearchStudyRuns('user-a', first.studyId, database)).resolves.toHaveLength(2);
    await expect(listResearchStudyRuns('user-b', first.studyId, database)).resolves.toBeNull();
  });

  it('hashes equivalent payloads independently of object key order', () => {
    expect(researchPayloadHash({ b: 2, a: { d: 4, c: 3 } })).toBe(
      researchPayloadHash({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });
});

function sampleRun(observations = 12): ResearchRunResultV1 {
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
    },
    protocol: { id: 'time_series_relationship', version: 1 },
    result: { kind: 'time_series_relationship', observations },
    coverage: [],
    conclusion: { level: 'indeterminate' },
    diagnostics: [],
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
    'CREATE TABLE "ResearchStudy" ("id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "conversationId" TEXT NOT NULL, "title" TEXT NOT NULL, "question" JSONB NOT NULL, "status" TEXT NOT NULL DEFAULT \'active\', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE, FOREIGN KEY ("conversationId") REFERENCES "AgentConversation"("id") ON DELETE CASCADE)',
    'CREATE TABLE "ResearchRun" ("id" TEXT NOT NULL PRIMARY KEY, "studyId" TEXT NOT NULL, "parentRunId" TEXT, "sourceTurnId" TEXT, "sourceMessageId" TEXT, "sourcePartIndex" INTEGER, "sequence" INTEGER NOT NULL, "origin" TEXT NOT NULL, "protocolId" TEXT NOT NULL, "protocolVersion" INTEGER NOT NULL, "plan" JSONB NOT NULL, "result" JSONB NOT NULL, "planHash" TEXT NOT NULL, "resultHash" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY ("studyId") REFERENCES "ResearchStudy"("id") ON DELETE CASCADE, FOREIGN KEY ("parentRunId") REFERENCES "ResearchRun"("id") ON DELETE SET NULL, FOREIGN KEY ("sourceTurnId") REFERENCES "AgentTurn"("id") ON DELETE SET NULL, FOREIGN KEY ("sourceMessageId") REFERENCES "AgentMessage"("id") ON DELETE SET NULL)',
    'CREATE UNIQUE INDEX "User_email_key" ON "User"("email")',
    'CREATE UNIQUE INDEX "AgentMessage_conversationId_sequence_key" ON "AgentMessage"("conversationId", "sequence")',
    'CREATE UNIQUE INDEX "ResearchRun_studyId_sequence_key" ON "ResearchRun"("studyId", "sequence")',
    'CREATE UNIQUE INDEX "ResearchRun_sourceMessageId_sourcePartIndex_key" ON "ResearchRun"("sourceMessageId", "sourcePartIndex")',
  ];
  for (const statement of statements) {
    await database.$executeRawUnsafe(statement);
  }
}
