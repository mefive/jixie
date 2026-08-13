import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Prisma, PrismaClient } from '@prisma/client';
import prismaPackage from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  legacyScreenSpecToUniverseSpec,
  migrateScreenDataToResearch,
} from './screen-data-migration.js';

const { PrismaClient: RuntimePrismaClient } = prismaPackage;

describe('screen data migration', () => {
  let temporaryDirectory: string;
  let database: PrismaClient;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'jixie-screen-research-'));
    database = new RuntimePrismaClient({
      datasourceUrl: `file:${join(temporaryDirectory, 'migration.db')}`,
    });
    await createFixtureSchema(database);
  });

  afterEach(async () => {
    await database.$disconnect();
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('maps every legacy field to the versioned UniverseSpec vocabulary', () => {
    const universe = legacyScreenSpecToUniverseSpec({
      filters: [
        { field: 'close', op: '>', value: 1 },
        { field: 'pctChg', op: '>=', value: 2 },
        { field: 'pe', op: '<', value: 3 },
        { field: 'peTtm', op: '<=', value: 4 },
        { field: 'pb', op: '>', value: 5 },
        { field: 'ps', op: '>=', value: 6 },
        { field: 'dvRatio', op: '<', value: 7 },
        { field: 'totalMv', op: '<=', value: 8 },
        { field: 'circMv', op: '>', value: 9 },
        { field: 'turnoverRate', op: '>=', value: 10 },
      ],
      sort: { field: 'totalMv', dir: 'desc' },
      limit: 20,
    });

    expect(universe.predicates.map((predicate) => predicate.measure)).toEqual([
      'equity.close',
      'equity.daily_return_pct',
      'equity.pe',
      'equity.pe_ttm',
      'equity.pb',
      'equity.ps',
      'equity.dividend_yield_pct',
      'equity.total_market_cap_cny_10k',
      'equity.float_market_cap_cny_10k',
      'equity.turnover_rate_pct',
    ]);
    expect(universe.sort).toEqual({
      measure: 'equity.total_market_cap_cny_10k',
      measureVersion: 1,
      direction: 'desc',
    });
  });

  it('moves conversations and saved screens once, then repeats without duplicates', async () => {
    await seedLegacyData(database);

    const first = await migrateScreenDataToResearch(database);
    expect(first).toMatchObject({
      screenConversations: 1,
      savedScreens: 1,
      createdConversations: 2,
      movedTurns: 1,
      appendedMessages: 3,
    });
    expect(await database.agentConversation.count({ where: { surface: 'research' } })).toBe(2);
    expect(
      await database.agentConversation.findUnique({ where: { id: 'legacy-agent' } }),
    ).not.toBeNull();
    expect(
      await database.agentTurn.findUnique({
        where: { id: 'turn-1' },
        select: { conversationId: true },
      }),
    ).toEqual({ conversationId: 'screen-conversation' });

    const migratedConversation = await database.agentConversation.findUniqueOrThrow({
      where: { id: 'screen-conversation' },
      include: { messages: { orderBy: { sequence: 'asc' } } },
    });
    const targetRelation = await database.$queryRawUnsafe<
      Array<{ screenConversationId: string | null }>
    >(
      'SELECT "screenConversationId" FROM "AgentConversation" WHERE "id" = ?',
      'screen-conversation',
    );
    expect(targetRelation[0]?.screenConversationId).toBeNull();
    expect(migratedConversation.messages).toHaveLength(2);
    const conversationParts = migratedConversation.messages[1]?.parts as unknown as Array<
      Record<string, unknown>
    >;
    expect(conversationParts[1]).toMatchObject({
      type: 'universe',
      spec: {
        version: 1,
        predicates: [{ measure: 'equity.pe_ttm', op: '<', value: 20 }],
      },
    });

    const migratedSaved = await database.agentConversation.findUniqueOrThrow({
      where: { id: 'saved-screen' },
      include: { messages: true },
    });
    const savedParts = migratedSaved.messages[0]?.parts as unknown as Array<
      Record<string, unknown>
    >;
    expect(savedParts[0]).toMatchObject({
      type: 'universe',
      title: 'High dividend',
      spec: {
        predicates: [{ measure: 'equity.dividend_yield_pct', op: '>=', value: 3 }],
      },
    });

    const second = await migrateScreenDataToResearch(database);
    expect(second).toMatchObject({
      screenConversations: 1,
      savedScreens: 1,
      createdConversations: 0,
      reusedConversations: 2,
      movedTurns: 0,
      appendedMessages: 0,
    });
    expect(await database.agentConversation.count({ where: { surface: 'research' } })).toBe(2);
    expect(await database.agentMessage.count()).toBe(5);

    const finalized = await migrateScreenDataToResearch(database, { finalize: true });
    expect(finalized).toMatchObject({
      finalize: true,
      removedLegacyConversations: 1,
      movedTurns: 0,
      appendedMessages: 0,
    });
    expect(
      await database.agentConversation.findUnique({ where: { id: 'legacy-agent' } }),
    ).toBeNull();
    expect(await database.agentTurn.findUnique({ where: { id: 'turn-1' } })).toMatchObject({
      conversationId: 'screen-conversation',
    });
    expect(await database.agentMessage.count()).toBe(3);

    await expect(migrateScreenDataToResearch(database, { finalize: true })).resolves.toMatchObject({
      removedLegacyConversations: 0,
    });
  });

  it('runs the complete migration and verification in dry-run mode, then rolls back', async () => {
    await seedLegacyData(database);

    await expect(
      migrateScreenDataToResearch(database, { dryRun: true, finalize: true }),
    ).resolves.toMatchObject({
      dryRun: true,
      finalize: true,
      screenConversations: 1,
      savedScreens: 1,
      createdConversations: 2,
      movedTurns: 1,
      removedLegacyConversations: 1,
    });
    expect(await database.agentConversation.count({ where: { surface: 'research' } })).toBe(0);
    expect(
      await database.agentConversation.findUnique({ where: { id: 'legacy-agent' } }),
    ).not.toBeNull();
    expect(await database.agentMessage.count()).toBe(2);
  });

  it('validates every source before writing and blocks malformed specs', async () => {
    await database.user.create({ data: { id: 'user-1', email: 'user@example.com' } });
    await database.$executeRawUnsafe(
      'INSERT INTO "SavedScreen" ("id", "userId", "name", "spec", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
      'bad-screen',
      'user-1',
      'Broken',
      JSON.stringify({ filters: [{ field: 'unknown', op: '>', value: 1 }] }),
    );

    await expect(migrateScreenDataToResearch(database)).rejects.toThrow(
      'SavedScreen bad-screen cannot migrate',
    );
    expect(await database.agentConversation.count()).toBe(0);
    expect(await database.agentMessage.count()).toBe(0);
  });

  it('blocks a direct cutover when legacy rows exist but the Agent target schema is absent', async () => {
    await seedLegacyData(database);
    await database.$executeRawUnsafe('DROP TABLE "AgentMessage"');
    await database.$executeRawUnsafe('DROP TABLE "AgentTurn"');
    await database.$executeRawUnsafe('DROP TABLE "AgentConversation"');

    await expect(migrateScreenDataToResearch(database)).rejects.toThrow(
      'deploy the Agent conversation foundation before the Screen cutover',
    );
  });

  it('treats absent legacy tables as a successful no-op', async () => {
    await database.$executeRawUnsafe('DROP TABLE "SavedScreen"');
    await database.$executeRawUnsafe('DROP TABLE "ScreenConversation"');

    await expect(migrateScreenDataToResearch(database)).resolves.toMatchObject({
      sourceTablesPresent: false,
      deferred: false,
      screenConversations: 0,
      savedScreens: 0,
    });
  });
});

async function seedLegacyData(database: PrismaClient): Promise<void> {
  const screenSpec = {
    filters: [{ field: 'peTtm', op: '<', value: 20 }],
    sort: { field: 'totalMv', dir: 'desc' },
    limit: 10,
  };
  const messages = [
    { role: 'user', content: 'Find inexpensive stocks' },
    {
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Here is the screen.' },
        { type: 'card', title: 'Inexpensive stocks', spec: screenSpec },
      ],
    },
  ];
  await database.user.create({ data: { id: 'user-1', email: 'user@example.com' } });
  await database.$executeRawUnsafe(
    'INSERT INTO "ScreenConversation" ("id", "userId", "title", "messages", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
    'screen-conversation',
    'user-1',
    'Inexpensive stocks',
    JSON.stringify(messages),
  );
  await database.$executeRawUnsafe(
    'INSERT INTO "SavedScreen" ("id", "userId", "name", "spec", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
    'saved-screen',
    'user-1',
    'High dividend',
    JSON.stringify({
      filters: [{ field: 'dvRatio', op: '>=', value: 3 }],
      sort: { field: 'dvRatio', dir: 'desc' },
      limit: 10,
    }),
  );
  await database.$executeRawUnsafe(
    'INSERT INTO "AgentConversation" ("id", "userId", "surface", "title", "screenConversationId", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
    'legacy-agent',
    'user-1',
    'screen',
    'Inexpensive stocks',
    'screen-conversation',
  );
  await database.agentTurn.create({
    data: {
      id: 'turn-1',
      conversationId: 'legacy-agent',
      status: 'done',
      model: 'fixture',
      trace: { version: 1, steps: [], truncated: false },
    },
  });
  await database.agentMessage.createMany({
    data: messages.map((message, sequence) => {
      const parts =
        'parts' in message && message.parts
          ? message.parts
          : [{ type: 'text', text: 'content' in message ? message.content : '' }];
      return {
        id: `message-${sequence}`,
        conversationId: 'legacy-agent',
        role: message.role,
        parts: parts as unknown as Prisma.InputJsonValue,
        sequence,
        ...(sequence === 1 ? { turnId: 'turn-1' } : {}),
      };
    }),
  });
}

async function createFixtureSchema(database: PrismaClient): Promise<void> {
  const statements = [
    `CREATE TABLE "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "email" TEXT NOT NULL,
      "name" TEXT,
      "status" TEXT NOT NULL DEFAULT 'active',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE "SavedScreen" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "spec" JSONB NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )`,
    `CREATE TABLE "ScreenConversation" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "messages" JSONB NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )`,
    `CREATE TABLE "AgentConversation" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "surface" TEXT NOT NULL,
      "title" TEXT,
      "strategyId" TEXT,
      "factorId" TEXT,
      "screenConversationId" TEXT,
      "archivedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )`,
    `CREATE TABLE "AgentTurn" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "conversationId" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "model" TEXT NOT NULL,
      "trace" JSONB NOT NULL,
      "error" TEXT,
      "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "finishedAt" DATETIME
    )`,
    `CREATE TABLE "AgentMessage" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "conversationId" TEXT NOT NULL,
      "role" TEXT NOT NULL,
      "parts" JSONB NOT NULL,
      "sequence" INTEGER NOT NULL,
      "turnId" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    'CREATE UNIQUE INDEX "User_email_key" ON "User"("email")',
    'CREATE UNIQUE INDEX "AgentMessage_conversationId_sequence_key" ON "AgentMessage"("conversationId", "sequence")',
  ];
  for (const statement of statements) {
    await database.$executeRawUnsafe(statement);
  }
}
