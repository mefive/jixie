import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  type MessagePart,
  type ResearchPart,
  type ResearchRunRecordV1,
  type ResearchRunResultV1,
} from '@jixie/shared';
import { ulid } from 'ulid';
import { prisma } from '../lib/prisma.js';

interface PersistResearchMessagePartsArgs {
  conversationId: string;
  messageId: string;
  turnId?: string;
  userId: string;
  parts: MessagePart[];
}

/** Persist every research artifact beside its chat part and attach the stable record reference. */
export async function persistResearchMessageParts(
  transaction: Prisma.TransactionClient,
  args: PersistResearchMessagePartsArgs,
): Promise<MessagePart[]> {
  const persistedParts: MessagePart[] = [];

  for (const [partIndex, part] of args.parts.entries()) {
    if (part.type !== 'research') {
      persistedParts.push(part);
      continue;
    }

    const existing = await transaction.researchRun.findFirst({
      where: { sourceMessageId: args.messageId, sourcePartIndex: partIndex },
      select: { id: true, studyId: true, sequence: true, createdAt: true },
    });
    if (existing) {
      persistedParts.push(withRecordReference(part, existing));
      continue;
    }

    const studyId = ulid();
    const runId = ulid();
    const createdAt = new Date();
    await transaction.researchStudy.create({
      data: {
        id: studyId,
        userId: args.userId,
        conversationId: args.conversationId,
        title: part.title,
        question: part.run.plan.question as unknown as Prisma.InputJsonValue,
      },
    });
    await transaction.researchRun.create({
      data: {
        id: runId,
        studyId,
        sourceTurnId: args.turnId,
        sourceMessageId: args.messageId,
        sourcePartIndex: partIndex,
        sequence: 1,
        origin: 'agent',
        protocolId: part.run.protocol.id,
        protocolVersion: part.run.protocol.version,
        plan: part.run.plan as unknown as Prisma.InputJsonValue,
        result: part.run as unknown as Prisma.InputJsonValue,
        planHash: researchPayloadHash(part.run.plan),
        resultHash: researchPayloadHash(part.run),
        createdAt,
      },
    });
    persistedParts.push(withRecordReference(part, { id: runId, studyId, sequence: 1, createdAt }));
  }

  return persistedParts;
}

export async function createResearchRerun(
  args: {
    userId: string;
    studyId: string;
    parentRunId: string;
    run: ResearchRunResultV1;
  },
  database: PrismaClient = prisma,
): Promise<ResearchRunRecordV1 | null> {
  return database.$transaction(async (transaction) => {
    const study = await transaction.researchStudy.findFirst({
      where: { id: args.studyId, userId: args.userId, status: 'active' },
      select: {
        id: true,
        title: true,
        runs: {
          orderBy: { sequence: 'desc' },
          take: 1,
          select: { sequence: true },
        },
      },
    });
    if (!study) {
      return null;
    }
    const parent = await transaction.researchRun.findFirst({
      where: { id: args.parentRunId, studyId: study.id },
      select: { id: true },
    });
    if (!parent) {
      return null;
    }

    const id = ulid();
    const sequence = (study.runs[0]?.sequence ?? 0) + 1;
    const createdAt = new Date();
    const planHash = researchPayloadHash(args.run.plan);
    const resultHash = researchPayloadHash(args.run);
    await transaction.researchRun.create({
      data: {
        id,
        studyId: study.id,
        parentRunId: parent.id,
        sequence,
        origin: 'parameter_rerun',
        protocolId: args.run.protocol.id,
        protocolVersion: args.run.protocol.version,
        plan: args.run.plan as unknown as Prisma.InputJsonValue,
        result: args.run as unknown as Prisma.InputJsonValue,
        planHash,
        resultHash,
        createdAt,
      },
    });
    await transaction.researchStudy.update({
      where: { id: study.id },
      data: { updatedAt: createdAt },
    });

    return {
      ref: {
        version: 1,
        studyId: study.id,
        runId: id,
        sequence,
        createdAt: createdAt.toISOString(),
      },
      title: study.title,
      origin: 'parameter_rerun',
      parentRunId: parent.id,
      planHash,
      resultHash,
      run: args.run,
    };
  });
}

export async function listResearchStudyRuns(
  userId: string,
  studyId: string,
  database: PrismaClient = prisma,
): Promise<ResearchRunRecordV1[] | null> {
  const study = await database.researchStudy.findFirst({
    where: { id: studyId, userId, status: 'active' },
    select: {
      id: true,
      title: true,
      runs: { orderBy: { sequence: 'asc' } },
    },
  });
  if (!study) {
    return null;
  }

  return study.runs.map((run) => ({
    ref: {
      version: 1,
      studyId: study.id,
      runId: run.id,
      sequence: run.sequence,
      createdAt: run.createdAt.toISOString(),
    },
    title: study.title,
    origin: run.origin === 'parameter_rerun' ? 'parameter_rerun' : 'agent',
    ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}),
    planHash: run.planHash,
    resultHash: run.resultHash,
    run: run.result as unknown as ResearchRunResultV1,
  }));
}

export interface ResearchRecordMigrationSummary {
  messagesScanned: number;
  messagesUpdated: number;
  studiesCreated: number;
  runsCreated: number;
}

/** Backfill typed research artifacts that were persisted in chat before formal run records existed. */
export async function migrateResearchRecords(
  database: PrismaClient = prisma,
): Promise<ResearchRecordMigrationSummary> {
  const messages = await database.agentMessage.findMany({
    where: { role: 'assistant', conversation: { surface: 'research' } },
    select: {
      id: true,
      turnId: true,
      parts: true,
      conversation: { select: { id: true, userId: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  const researchMessages = messages.filter((message) => hasResearchPart(message.parts));
  const beforeStudies = await database.researchStudy.count();
  const beforeRuns = await database.researchRun.count();
  let messagesUpdated = 0;

  for (const message of researchMessages) {
    await database.$transaction(async (transaction) => {
      const parts = message.parts as unknown as MessagePart[];
      const persisted = await persistResearchMessageParts(transaction, {
        conversationId: message.conversation.id,
        messageId: message.id,
        turnId: message.turnId ?? undefined,
        userId: message.conversation.userId,
        parts,
      });
      if (JSON.stringify(parts) !== JSON.stringify(persisted)) {
        await transaction.agentMessage.update({
          where: { id: message.id },
          data: { parts: persisted as unknown as Prisma.InputJsonValue },
        });
        messagesUpdated++;
      }
    });
  }

  return {
    messagesScanned: researchMessages.length,
    messagesUpdated,
    studiesCreated: (await database.researchStudy.count()) - beforeStudies,
    runsCreated: (await database.researchRun.count()) - beforeRuns,
  };
}

export function researchPayloadHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function withRecordReference(
  part: ResearchPart,
  run: { id: string; studyId: string; sequence: number; createdAt: Date },
): ResearchPart {
  return {
    ...part,
    record: {
      version: 1,
      studyId: run.studyId,
      runId: run.id,
      sequence: run.sequence,
      createdAt: run.createdAt.toISOString(),
    },
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function hasResearchPart(parts: Prisma.JsonValue): boolean {
  return (
    Array.isArray(parts) &&
    parts.some(
      (part) =>
        typeof part === 'object' &&
        part !== null &&
        !Array.isArray(part) &&
        part.type === 'research' &&
        typeof part.run === 'object' &&
        part.run !== null,
    )
  );
}
