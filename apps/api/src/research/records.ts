import type {
  Prisma,
  PrismaClient,
  ResearchAttempt as ResearchAttemptRow,
  ResearchRun as ResearchRunRow,
} from '@prisma/client';
import {
  type AgentTurnTrace,
  type MessagePart,
  type ResearchAttemptRecordV1,
  type ResearchPlanChangeV1,
  type ResearchPlanSpecV1,
  type ResearchPart,
  type ResearchRunComparisonV1,
  type ResearchRunRecordV1,
  type ResearchRunResultV1,
} from '@jixie/shared';
import { ulid } from 'ulid';
import { prisma } from '../lib/prisma.js';
import { researchPayloadHash } from './fingerprints.js';
import { persistResearchCellChangePart } from './research-cell-change-records.js';
import { researchPlanSpecV1Schema } from './spec.js';

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
    if (part.type === 'research_cell_change') {
      persistedParts.push(
        await persistResearchCellChangePart(transaction, {
          conversationId: args.conversationId,
          messageId: args.messageId,
          turnId: args.turnId,
          userId: args.userId,
          partIndex,
          part,
        }),
      );
      continue;
    }
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

    const study = await findOrCreateRunlessStudy(transaction, {
      conversationId: args.conversationId,
      userId: args.userId,
      title: part.title,
      question: part.run.plan.question,
    });
    const studyId = study.id;
    const runId = ulid();
    const createdAt = new Date();
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

/** Persist a Validation-cell result in the same immutable evidence lineage as Agent research. */
export async function createWorkbenchResearchRun(
  args: {
    userId: string;
    conversationId: string;
    title: string;
    run: ResearchRunResultV1;
  },
  database: PrismaClient = prisma,
): Promise<ResearchPart> {
  return database.$transaction(async (transaction) => {
    const studies = await transaction.researchStudy.findMany({
      where: {
        userId: args.userId,
        conversationId: args.conversationId,
        status: 'active',
      },
      select: { id: true, question: true },
      orderBy: { createdAt: 'asc' },
    });
    const questionHash = researchPayloadHash(args.run.plan.question);
    let study = studies.find(
      (candidate) => researchPayloadHash(candidate.question) === questionHash,
    );
    if (!study) {
      study = await transaction.researchStudy.create({
        data: {
          id: ulid(),
          userId: args.userId,
          conversationId: args.conversationId,
          title: args.title,
          question: args.run.plan.question as unknown as Prisma.InputJsonValue,
        },
        select: { id: true, question: true },
      });
    }
    const parent = await transaction.researchRun.findFirst({
      where: { studyId: study.id },
      orderBy: { sequence: 'desc' },
    });
    const createdAt = new Date();
    const stored = await transaction.researchRun.create({
      data: {
        id: ulid(),
        studyId: study.id,
        parentRunId: parent?.id,
        sequence: (parent?.sequence ?? 0) + 1,
        origin: 'workbench',
        protocolId: args.run.protocol.id,
        protocolVersion: args.run.protocol.version,
        plan: args.run.plan as unknown as Prisma.InputJsonValue,
        result: args.run as unknown as Prisma.InputJsonValue,
        planHash: researchPayloadHash(args.run.plan),
        resultHash: researchResultHash(args.run),
        ...fingerprintColumns(args.run),
        createdAt,
      },
    });
    await transaction.researchStudy.update({
      where: { id: study.id },
      data: { title: args.title, updatedAt: createdAt },
    });

    return withRecordReference({ type: 'research', title: args.title, run: args.run }, stored);
  });
}

export async function createFailedResearchAttempt(
  args: {
    userId: string;
    studyId: string;
    parentRunId: string;
    plan: ResearchPlanSpecV1;
    error: string;
  },
  database: PrismaClient = prisma,
): Promise<ResearchAttemptRecordV1 | null> {
  return database.$transaction(async (transaction) => {
    const study = await transaction.researchStudy.findFirst({
      where: {
        id: args.studyId,
        userId: args.userId,
        status: 'active',
        runs: { some: { id: args.parentRunId } },
      },
      select: { id: true, conversationId: true },
    });
    if (!study) {
      return null;
    }
    const parent = await transaction.researchRun.findUnique({ where: { id: args.parentRunId } });
    if (!parent) {
      return null;
    }
    const createdAt = new Date();
    const stored = await transaction.researchAttempt.create({
      data: {
        id: ulid(),
        userId: args.userId,
        conversationId: study.conversationId,
        studyId: study.id,
        parentRunId: parent.id,
        origin: 'parameter_rerun',
        plan: args.plan as unknown as Prisma.InputJsonValue,
        planHash: researchPayloadHash(args.plan),
        arguments: JSON.stringify({ parentRunId: parent.id, plan: args.plan }),
        error: normalizeAttemptError(args.error),
        createdAt,
      },
    });
    await transaction.researchStudy.update({
      where: { id: study.id },
      data: { updatedAt: createdAt },
    });
    return researchAttemptRecord(stored, parent);
  });
}

export async function persistFailedResearchAttempts(
  transaction: Prisma.TransactionClient,
  args: {
    conversationId: string;
    turnId: string;
    userId: string;
    trace: AgentTurnTrace;
  },
): Promise<number> {
  const failedSteps = (Array.isArray(args.trace.steps) ? args.trace.steps : []).filter(
    (step): step is Extract<AgentTurnTrace['steps'][number], { type: 'tool' }> =>
      step.type === 'tool' && step.name === 'executeResearchPlan' && !step.ok,
  );
  if (failedSteps.length === 0) {
    return 0;
  }
  const sourceRuns = await transaction.researchRun.findMany({
    where: { sourceTurnId: args.turnId },
    select: { studyId: true, plan: true },
  });
  let created = 0;

  for (const step of failedSteps) {
    if (await transaction.researchAttempt.findUnique({ where: { sourceStepId: step.id } })) {
      continue;
    }
    const parsed = parseResearchToolArguments(step.arguments);
    const validPlan = parsed.plan
      ? researchPlanSpecV1Schema.safeParse(parsed.plan)
      : ({ success: false } as const);
    let studyId: string | undefined;
    if (validPlan.success) {
      const questionHash = researchPayloadHash(validPlan.data.question);
      studyId = sourceRuns.find(
        (run) => researchPayloadHash(extractPlanQuestion(run.plan)) === questionHash,
      )?.studyId;
      if (!studyId && sourceRuns.length === 1) {
        studyId = sourceRuns[0]!.studyId;
      }
      if (!studyId) {
        studyId = (
          await findOrCreateRunlessStudy(transaction, {
            conversationId: args.conversationId,
            userId: args.userId,
            title: validPlan.data.question.text.slice(0, 120),
            question: validPlan.data.question,
          })
        ).id;
      }
    }
    await transaction.researchAttempt.create({
      data: {
        id: ulid(),
        userId: args.userId,
        conversationId: args.conversationId,
        ...(studyId ? { studyId } : {}),
        sourceTurnId: args.turnId,
        sourceStepId: step.id,
        origin: 'agent',
        ...(parsed.plan ? { plan: parsed.plan as Prisma.InputJsonValue } : {}),
        ...(parsed.plan ? { planHash: researchPayloadHash(parsed.plan) } : {}),
        arguments: step.arguments,
        error: normalizeAttemptError(step.observation),
        createdAt: validDate(step.createdAt),
      },
    });
    created++;
  }
  return created;
}

export async function listResearchStudyAttempts(
  userId: string,
  studyId: string,
  database: PrismaClient = prisma,
): Promise<ResearchAttemptRecordV1[] | null> {
  const study = await database.researchStudy.findFirst({
    where: { id: studyId, userId, status: 'active' },
    select: {
      attempts: { orderBy: { createdAt: 'asc' } },
      runs: true,
    },
  });
  if (!study) {
    return null;
  }
  const runById = new Map(study.runs.map((run) => [run.id, run]));
  return study.attempts.map((attempt) =>
    researchAttemptRecord(
      attempt,
      attempt.parentRunId ? runById.get(attempt.parentRunId) : undefined,
    ),
  );
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
    origin:
      run.origin === 'parameter_rerun'
        ? 'parameter_rerun'
        : run.origin === 'workbench'
          ? 'workbench'
          : 'agent',
    ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}),
    planHash: run.planHash,
    resultHash: run.resultHash,
    run: run.result as unknown as ResearchRunResultV1,
    ...(parent ? { comparisonToParent: compareResearchRunRows(parent, run) } : {}),
  };
}

function researchAttemptRecord(
  attempt: ResearchAttemptRow,
  parent?: ResearchRunRow,
): ResearchAttemptRecordV1 {
  const parsedPlan = attempt.plan ? researchPlanSpecV1Schema.safeParse(attempt.plan) : null;
  const plan = parsedPlan?.success ? parsedPlan.data : undefined;
  const planDifference =
    parent && attempt.plan
      ? compareResearchPlans(parent.plan, attempt.plan)
      : { changes: [], truncated: false };
  return {
    version: 1,
    id: attempt.id,
    ...(attempt.studyId ? { studyId: attempt.studyId } : {}),
    ...(attempt.parentRunId ? { parentRunId: attempt.parentRunId } : {}),
    origin: attempt.origin === 'parameter_rerun' ? 'parameter_rerun' : 'agent',
    ...(plan ? { plan } : {}),
    ...(attempt.planHash ? { planHash: attempt.planHash } : {}),
    error: attempt.error,
    createdAt: attempt.createdAt.toISOString(),
    planChanges: planDifference.changes,
    planChangesTruncated: planDifference.truncated,
  };
}

async function findOrCreateRunlessStudy(
  transaction: Prisma.TransactionClient,
  args: {
    conversationId: string;
    userId: string;
    title: string;
    question: ResearchPlanSpecV1['question'];
  },
): Promise<{ id: string }> {
  const candidates = await transaction.researchStudy.findMany({
    where: {
      conversationId: args.conversationId,
      userId: args.userId,
      status: 'active',
      runs: { none: {} },
    },
    select: { id: true, question: true },
    orderBy: { createdAt: 'asc' },
  });
  const questionHash = researchPayloadHash(args.question);
  const existing = candidates.find(
    (candidate) => researchPayloadHash(candidate.question) === questionHash,
  );
  if (existing) {
    return { id: existing.id };
  }
  return transaction.researchStudy.create({
    data: {
      id: ulid(),
      userId: args.userId,
      conversationId: args.conversationId,
      title: args.title,
      question: args.question as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
}

function parseResearchToolArguments(argumentsText: string): { plan?: Prisma.JsonValue } {
  try {
    const parsed = JSON.parse(argumentsText) as unknown;
    if (isPlainObject(parsed) && isPlainObject(parsed.plan)) {
      return { plan: parsed.plan as Prisma.JsonObject };
    }
  } catch {
    // Malformed tool arguments are retained verbatim but cannot form a typed plan or Study.
  }
  return {};
}

function extractPlanQuestion(plan: Prisma.JsonValue): unknown {
  return isPlainObject(plan) ? plan.question : undefined;
}

function normalizeAttemptError(error: string): string {
  return error
    .replace(/^Tool execution failed:\s*/i, '')
    .trim()
    .slice(0, 8000);
}

function validDate(value: string): Date {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export interface ResearchRecordMigrationSummary {
  messagesScanned: number;
  messagesUpdated: number;
  studiesCreated: number;
  runsCreated: number;
  runsUpdated: number;
  attemptsCreated: number;
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
  const beforeAttempts = await database.researchAttempt.count();
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

  const researchTurns = await database.agentTurn.findMany({
    where: { conversation: { surface: 'research' } },
    select: {
      id: true,
      trace: true,
      conversation: { select: { id: true, userId: true } },
    },
    orderBy: { startedAt: 'asc' },
  });
  for (const turn of researchTurns) {
    await database.$transaction((transaction) =>
      persistFailedResearchAttempts(transaction, {
        conversationId: turn.conversation.id,
        turnId: turn.id,
        userId: turn.conversation.userId,
        trace: turn.trace as unknown as AgentTurnTrace,
      }),
    );
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
    attemptsCreated: (await database.researchAttempt.count()) - beforeAttempts,
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
