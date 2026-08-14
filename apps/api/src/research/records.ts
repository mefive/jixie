import type { Prisma, PrismaClient, ResearchRun as ResearchRunRow } from '@prisma/client';
import {
  type MessagePart,
  type ResearchPlanChangeV1,
  type ResearchPart,
  type ResearchRunComparisonV1,
  type ResearchRunRecordV1,
  type ResearchRunResultV1,
} from '@jixie/shared';
import { ulid } from 'ulid';
import { prisma } from '../lib/prisma.js';
import { researchPayloadHash } from './fingerprints.js';

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
        resultHash: researchResultHash(part.run),
        ...fingerprintColumns(part.run),
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
    });
    if (!parent) {
      return null;
    }

    const id = ulid();
    const sequence = (study.runs[0]?.sequence ?? 0) + 1;
    const createdAt = new Date();
    const planHash = researchPayloadHash(args.run.plan);
    const resultHash = researchResultHash(args.run);
    const stored = await transaction.researchRun.create({
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
        ...fingerprintColumns(args.run),
        createdAt,
      },
    });
    await transaction.researchStudy.update({
      where: { id: study.id },
      data: { updatedAt: createdAt },
    });

    return researchRunRecord(study.id, study.title, stored, parent);
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

  const runById = new Map(study.runs.map((run) => [run.id, run]));
  return study.runs.map((run) =>
    researchRunRecord(
      study.id,
      study.title,
      run,
      run.parentRunId ? runById.get(run.parentRunId) : undefined,
    ),
  );
}

export function compareResearchRunRows(
  base: ResearchRunRow,
  candidate: ResearchRunRow,
): ResearchRunComparisonV1 {
  const changes: ResearchRunComparisonV1['changes'] = [];
  const planDifference = compareResearchPlans(base.plan, candidate.plan);
  if (
    base.planHash !== candidate.planHash &&
    planDifference.changes.some(
      (change) => change.path !== 'protocol.kind' && change.path !== 'protocol.version',
    )
  ) {
    changes.push('parameters');
  }
  const protocolChanged =
    base.protocolId !== candidate.protocolId || base.protocolVersion !== candidate.protocolVersion;
  if (protocolChanged) {
    changes.push('protocol');
  } else if (
    base.protocolFingerprint &&
    candidate.protocolFingerprint &&
    base.protocolFingerprint !== candidate.protocolFingerprint
  ) {
    changes.push('implementation');
  }
  if (
    base.dataFingerprint &&
    candidate.dataFingerprint &&
    base.dataFingerprint !== candidate.dataFingerprint
  ) {
    changes.push('data');
  }
  if (
    base.environmentFingerprint &&
    candidate.environmentFingerprint &&
    base.environmentFingerprint !== candidate.environmentFingerprint
  ) {
    changes.push('environment');
  }

  const resultChanged = base.resultHash !== candidate.resultHash;
  const conclusionChanged = conclusionHash(base.result) !== conclusionHash(candidate.result);
  const fingerprintsAvailable = [
    base.protocolFingerprint,
    candidate.protocolFingerprint,
    base.dataFingerprint,
    candidate.dataFingerprint,
    base.environmentFingerprint,
    candidate.environmentFingerprint,
  ].every(Boolean);
  const attribution =
    changes.length === 0
      ? resultChanged
        ? 'unavailable'
        : 'unchanged'
      : resultChanged && !fingerprintsAvailable
        ? 'unavailable'
        : changes.length === 1
          ? changes[0]!
          : 'multiple';

  return {
    version: 1,
    baseRunId: base.id,
    candidateRunId: candidate.id,
    changes,
    planChanges: planDifference.changes,
    planChangesTruncated: planDifference.truncated,
    resultChanged,
    conclusionChanged,
    attribution,
  };
}

export function compareResearchPlans(
  base: Prisma.JsonValue,
  candidate: Prisma.JsonValue,
  maximumChanges = 12,
): { changes: ResearchPlanChangeV1[]; truncated: boolean } {
  const changes: ResearchPlanChangeV1[] = [];
  let truncated = false;

  const visit = (before: unknown, after: unknown, path: string): void => {
    if (researchPayloadHash(before) === researchPayloadHash(after)) {
      return;
    }
    if (changes.length >= maximumChanges) {
      truncated = true;
      return;
    }
    if (isPlainObject(before) && isPlainObject(after)) {
      const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
      for (const key of keys) {
        visit(before[key], after[key], path ? `${path}.${key}` : key);
      }
      return;
    }
    if (Array.isArray(before) && Array.isArray(after)) {
      const beforeById = indexObjectsById(before);
      const afterById = indexObjectsById(after);
      if (beforeById && afterById) {
        const ids = [...new Set([...beforeById.keys(), ...afterById.keys()])].sort();
        for (const id of ids) {
          visit(beforeById.get(id), afterById.get(id), `${path}[${id}]`);
        }
        return;
      }
    }
    changes.push({
      path: path || '$',
      before: summarizePlanValue(before),
      after: summarizePlanValue(after),
    });
  };

  visit(base, candidate, '');
  return { changes, truncated };
}

function researchRunRecord(
  studyId: string,
  title: string,
  run: ResearchRunRow,
  parent?: ResearchRunRow,
): ResearchRunRecordV1 {
  return {
    ref: {
      version: 1,
      studyId,
      runId: run.id,
      sequence: run.sequence,
      createdAt: run.createdAt.toISOString(),
    },
    title,
    origin: run.origin === 'parameter_rerun' ? 'parameter_rerun' : 'agent',
    ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}),
    planHash: run.planHash,
    resultHash: run.resultHash,
    run: run.result as unknown as ResearchRunResultV1,
    ...(parent ? { comparisonToParent: compareResearchRunRows(parent, run) } : {}),
  };
}

export interface ResearchRecordMigrationSummary {
  messagesScanned: number;
  messagesUpdated: number;
  studiesCreated: number;
  runsCreated: number;
  runsUpdated: number;
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

  const storedRuns = await database.researchRun.findMany({
    select: {
      id: true,
      result: true,
      resultHash: true,
      protocolFingerprint: true,
      dataFingerprint: true,
      environmentFingerprint: true,
    },
  });
  let runsUpdated = 0;
  for (const stored of storedRuns) {
    const run = stored.result as unknown as ResearchRunResultV1;
    const resultHash = researchResultHash(run);
    const fingerprints = fingerprintColumns(run);
    if (
      stored.resultHash === resultHash &&
      stored.protocolFingerprint === (fingerprints.protocolFingerprint ?? null) &&
      stored.dataFingerprint === (fingerprints.dataFingerprint ?? null) &&
      stored.environmentFingerprint === (fingerprints.environmentFingerprint ?? null)
    ) {
      continue;
    }
    await database.researchRun.update({
      where: { id: stored.id },
      data: { resultHash, ...fingerprints },
    });
    runsUpdated++;
  }

  return {
    messagesScanned: researchMessages.length,
    messagesUpdated,
    studiesCreated: (await database.researchStudy.count()) - beforeStudies,
    runsCreated: (await database.researchRun.count()) - beforeRuns,
    runsUpdated,
  };
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

function fingerprintColumns(run: ResearchRunResultV1) {
  return {
    protocolFingerprint: run.fingerprints?.protocol.implementationHash,
    dataFingerprint: run.fingerprints?.data.hash,
    environmentFingerprint: run.fingerprints?.environment.hash,
  };
}

function conclusionHash(result: Prisma.JsonValue): string {
  const run = result as unknown as { conclusion?: unknown };
  return researchPayloadHash(run.conclusion ?? null);
}

function researchResultHash(run: ResearchRunResultV1): string {
  return researchPayloadHash({
    coverage: run.coverage,
    result: run.result,
    conclusion: run.conclusion,
    diagnostics: run.diagnostics,
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function indexObjectsById(values: unknown[]): Map<string, unknown> | null {
  const indexed = new Map<string, unknown>();
  for (const value of values) {
    if (!isPlainObject(value) || typeof value.id !== 'string' || indexed.has(value.id)) {
      return null;
    }
    indexed.set(value.id, value);
  }
  return indexed;
}

function summarizePlanValue(value: unknown): string {
  if (value === undefined) {
    return '—';
  }
  if (Array.isArray(value)) {
    return `[${value.length} items] · ${researchPayloadHash(value).slice(0, 12)}`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value).length} fields} · ${researchPayloadHash(value).slice(0, 12)}`;
  }
  return JSON.stringify(value);
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
