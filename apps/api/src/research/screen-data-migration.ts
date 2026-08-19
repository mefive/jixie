import type { Prisma, PrismaClient } from '@prisma/client';
import {
  normalizeChatMessage,
  type ChatMessage,
  type MessagePart,
  type UniversePart,
  type UniverseSpecV1,
} from '@jixie/shared';
import { ulid } from 'ulid';
import { z } from 'zod';
import { chatMessageSchema } from '../lib/chat-schema.js';
import { universeSpecV1Schema } from './spec.js';

const legacyScreenFieldSchema = z.enum([
  'close',
  'pctChg',
  'pe',
  'peTtm',
  'pb',
  'ps',
  'dvRatio',
  'totalMv',
  'circMv',
  'turnoverRate',
]);

const legacyScreenSpecSchema = z.object({
  filters: z.array(
    z.object({
      field: legacyScreenFieldSchema,
      op: z.enum(['>', '>=', '<', '<=']),
      value: z.number().finite(),
    }),
  ),
  sort: z.object({ field: legacyScreenFieldSchema, dir: z.enum(['asc', 'desc']) }).optional(),
  limit: z.number().int().positive().max(200).optional(),
});

const initialUniverseSpecV1Schema = z.object({
  version: z.literal(1),
  source: z.union([
    z.object({ kind: z.literal('equity_market'), market: z.literal('CN') }),
    z.object({ kind: z.literal('index_members'), indexCode: z.string() }),
    z.object({
      kind: z.literal('explicit'),
      entities: z.array(
        z.object({ assetType: z.enum(['stock', 'etf', 'index', 'future']), id: z.string() }),
      ),
    }),
  ]),
  asOf: z.union([
    z.object({ kind: z.literal('fixed'), date: z.string() }),
    z.object({ kind: z.literal('latest_available') }),
    z.object({ kind: z.literal('periodic'), frequency: z.literal('month_end') }),
  ]),
  predicates: z.array(
    z.object({
      measure: z.string(),
      op: z.enum(['>', '>=', '<', '<=', '==', '!=']),
      value: z.union([z.number(), z.string()]),
    }),
  ),
  missing: z.literal('exclude'),
  sort: z.object({ measure: z.string(), direction: z.enum(['asc', 'desc']) }).optional(),
  limit: z.number().int().positive().optional(),
});

const UNIVERSE_MEASURE_BY_SCREEN_FIELD: Record<z.infer<typeof legacyScreenFieldSchema>, string> = {
  close: 'equity.close',
  pctChg: 'equity.daily_return_pct',
  pe: 'equity.pe',
  peTtm: 'equity.pe_ttm',
  pb: 'equity.pb',
  ps: 'equity.ps',
  dvRatio: 'equity.dividend_yield_pct',
  totalMv: 'equity.total_market_cap_cny_10k',
  circMv: 'equity.float_market_cap_cny_10k',
  turnoverRate: 'equity.turnover_rate_pct',
};

const LEGACY_UNIVERSE_SELECT = Object.values(UNIVERSE_MEASURE_BY_SCREEN_FIELD).map((measure) => ({
  measure,
  measureVersion: 1 as const,
}));

interface LegacyScreenConversationRow {
  id: string;
  userId: string;
  title: string;
  messages: unknown;
  createdAt: Date | string | number;
  updatedAt: Date | string | number;
}

interface LegacySavedScreenRow {
  id: string;
  userId: string;
  name: string;
  spec: unknown;
  createdAt: Date | string | number;
  updatedAt: Date | string | number;
}

interface PreparedScreenConversation extends Omit<
  LegacyScreenConversationRow,
  'messages' | 'createdAt' | 'updatedAt'
> {
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

interface PreparedSavedScreen extends Omit<
  LegacySavedScreenRow,
  'spec' | 'createdAt' | 'updatedAt'
> {
  universe: UniverseSpecV1;
  createdAt: Date;
  updatedAt: Date;
}

interface LinkedConversationRow {
  id: string;
  userId: string;
  surface: string;
}

export interface ScreenDataMigrationSummary {
  sourceTablesPresent: boolean;
  deferred: boolean;
  dryRun: boolean;
  finalize: boolean;
  screenConversations: number;
  savedScreens: number;
  createdConversations: number;
  reusedConversations: number;
  movedTurns: number;
  appendedMessages: number;
  removedLegacyConversations: number;
  convertedCards: number;
}

interface MutableMigrationCounts {
  createdConversations: number;
  reusedConversations: number;
  movedTurns: number;
  appendedMessages: number;
  removedLegacyConversations: number;
}

/** Convert one legacy latest-snapshot screen into the final point-in-time UniverseSpec vocabulary. */
export function legacyScreenSpecToUniverseSpec(input: unknown): UniverseSpecV1 {
  const legacy = legacyScreenSpecSchema.parse(parseJson(input));
  const universe: UniverseSpecV1 = {
    version: 1,
    source: { kind: 'equity_market', market: 'CN' },
    asOf: { kind: 'latest_available' },
    eligibility: {
      minimumListedDays: 0,
      suspension: 'exclude',
      riskWarning: 'include',
    },
    predicates: legacy.filters.map((filter) => ({
      measure: UNIVERSE_MEASURE_BY_SCREEN_FIELD[filter.field],
      measureVersion: 1,
      op: filter.op,
      value: filter.value,
    })),
    missing: 'exclude',
    select: LEGACY_UNIVERSE_SELECT,
    ...(legacy.sort
      ? {
          sort: {
            measure: UNIVERSE_MEASURE_BY_SCREEN_FIELD[legacy.sort.field],
            measureVersion: 1,
            direction: legacy.sort.dir,
          },
        }
      : {}),
    ...(legacy.limit !== undefined ? { limit: legacy.limit } : {}),
  };
  return universeSpecV1Schema.parse(universe);
}

/** Upgrade query-card parts without preserving any runtime dependency on ScreenSpec. */
export function migrateScreenMessage(raw: unknown): {
  message: ChatMessage;
  convertedCards: number;
} {
  const parsed = parseJson(raw) as { parts?: unknown };
  const base = normalizeChatMessage({ ...parsed, parts: undefined });
  const normalized = Array.isArray(parsed.parts)
    ? { ...base, parts: parsed.parts as MessagePart[] }
    : base;
  let convertedCards = 0;
  const legacyParts = normalized.parts as Array<
    MessagePart | { type: 'card'; title: string; spec: unknown }
  >;
  const parts = legacyParts.map((part): MessagePart => {
    if (part.type === 'universe') {
      return {
        ...part,
        spec: upgradeInitialUniverseSpec(part.spec),
      };
    }
    if (part.type !== 'card') {
      return part;
    }
    convertedCards += 1;
    return {
      type: 'universe',
      title: part.title,
      spec: legacyScreenSpecToUniverseSpec(part.spec),
    };
  });
  const message = chatMessageSchema.parse({ ...normalized, parts }) as ChatMessage;
  return { message, convertedCards };
}

function upgradeInitialUniverseSpec(input: unknown): UniverseSpecV1 {
  const current = universeSpecV1Schema.safeParse(input);
  if (current.success) {
    return current.data;
  }
  const initial = initialUniverseSpecV1Schema.parse(input);
  return universeSpecV1Schema.parse({
    ...initial,
    eligibility: {
      minimumListedDays: 0,
      suspension: 'exclude',
      riskWarning: 'include',
    },
    predicates: initial.predicates.map((predicate) => ({ ...predicate, measureVersion: 1 })),
    ...(initial.sort ? { sort: { ...initial.sort, measureVersion: 1 } } : {}),
    select: LEGACY_UNIVERSE_SELECT,
  });
}

/**
 * Idempotent application-level migration. Source reads deliberately use raw SQL so this module can
 * remain runnable after the legacy Prisma models are deleted; absent source tables are a no-op.
 */
export async function migrateScreenDataToResearch(
  database: PrismaClient,
  options: { dryRun?: boolean; finalize?: boolean } = {},
): Promise<ScreenDataMigrationSummary> {
  const dryRun = options.dryRun ?? false;
  const finalize = options.finalize ?? false;
  const [hasSavedScreen, hasScreenConversation, hasAgentConversation, hasAgentMessage] =
    await Promise.all([
      tableExists(database, 'SavedScreen'),
      tableExists(database, 'ScreenConversation'),
      tableExists(database, 'AgentConversation'),
      tableExists(database, 'AgentMessage'),
    ]);
  const sourceTablesPresent = hasSavedScreen || hasScreenConversation;
  if (!sourceTablesPresent) {
    return emptySummary({ sourceTablesPresent: false, deferred: false, dryRun, finalize });
  }
  if (!hasAgentConversation || !hasAgentMessage) {
    const [savedCount, conversationCount] = await Promise.all([
      hasSavedScreen ? tableRowCount(database, 'SavedScreen') : Promise.resolve(0),
      hasScreenConversation ? tableRowCount(database, 'ScreenConversation') : Promise.resolve(0),
    ]);
    if (savedCount + conversationCount > 0) {
      throw new Error(
        '[screen-research] legacy Screen data exists but AgentConversation is unavailable; deploy the Agent conversation foundation before the Screen cutover',
      );
    }
    return emptySummary({ sourceTablesPresent: true, deferred: true, dryRun, finalize });
  }
  const hasScreenConversationRelation = await columnExists(
    database,
    'AgentConversation',
    'screenConversationId',
  );

  const [screenRows, savedRows] = await Promise.all([
    hasScreenConversation
      ? database.$queryRawUnsafe<LegacyScreenConversationRow[]>(
          'SELECT "id", "userId", "title", "messages", "createdAt", "updatedAt" FROM "ScreenConversation" ORDER BY "id"',
        )
      : Promise.resolve([]),
    hasSavedScreen
      ? database.$queryRawUnsafe<LegacySavedScreenRow[]>(
          'SELECT "id", "userId", "name", "spec", "createdAt", "updatedAt" FROM "SavedScreen" ORDER BY "id"',
        )
      : Promise.resolve([]),
  ]);
  const preparedScreens = screenRows.map(prepareScreenConversation);
  const preparedSaved = savedRows.map(prepareSavedScreen);
  assertDistinctSourceIds(preparedScreens, preparedSaved);

  const convertedCards = preparedScreens.reduce(
    (total, screen) =>
      total +
      screen.messages.reduce(
        (messageTotal, message) =>
          messageTotal + message.parts.filter((part) => part.type === 'universe').length,
        0,
      ),
    0,
  );
  const execute = async (transaction: Prisma.TransactionClient) => {
    const mutable: MutableMigrationCounts = {
      createdConversations: 0,
      reusedConversations: 0,
      movedTurns: 0,
      appendedMessages: 0,
      removedLegacyConversations: 0,
    };
    const legacyConversationIds: string[] = [];
    for (const screen of preparedScreens) {
      const legacyConversationId = await migrateConversation(
        transaction,
        screen,
        mutable,
        hasScreenConversationRelation,
      );
      if (legacyConversationId) {
        legacyConversationIds.push(legacyConversationId);
      }
    }
    for (const saved of preparedSaved) {
      await migrateSavedScreen(transaction, saved, mutable);
    }
    await verifyMigration(transaction, preparedScreens, preparedSaved);
    if (finalize) {
      for (const conversationId of legacyConversationIds) {
        const remainingTurns = await transaction.agentTurn.count({ where: { conversationId } });
        if (remainingTurns > 0) {
          throw new Error(
            `[screen-research] cannot remove legacy conversation ${conversationId}: ${remainingTurns} turns remain`,
          );
        }
        await transaction.agentMessage.deleteMany({ where: { conversationId } });
        await transaction.agentConversation.delete({ where: { id: conversationId } });
        mutable.removedLegacyConversations += 1;
      }
    }
    return mutable;
  };
  let counts: MutableMigrationCounts;
  if (dryRun) {
    try {
      await database.$transaction(async (transaction) => {
        const planned = await execute(transaction);
        throw new DryRunRollback(planned);
      });
      throw new Error('[screen-research] dry-run transaction unexpectedly committed');
    } catch (error) {
      if (!(error instanceof DryRunRollback)) {
        throw error;
      }
      counts = error.counts;
    }
  } else {
    counts = await database.$transaction(execute);
  }

  return {
    sourceTablesPresent: true,
    deferred: false,
    dryRun,
    finalize,
    screenConversations: preparedScreens.length,
    savedScreens: preparedSaved.length,
    ...counts,
    convertedCards,
  };
}

function prepareScreenConversation(row: LegacyScreenConversationRow): PreparedScreenConversation {
  const rawMessages = parseJson(row.messages);
  if (!Array.isArray(rawMessages)) {
    throw new Error(`[screen-research] ScreenConversation ${row.id} messages must be an array`);
  }
  const messages = rawMessages.map((rawMessage) => migrateScreenMessage(rawMessage).message);
  return { ...row, createdAt: toDate(row.createdAt), updatedAt: toDate(row.updatedAt), messages };
}

function prepareSavedScreen(row: LegacySavedScreenRow): PreparedSavedScreen {
  try {
    return {
      ...row,
      createdAt: toDate(row.createdAt),
      updatedAt: toDate(row.updatedAt),
      universe: legacyScreenSpecToUniverseSpec(row.spec),
    };
  } catch (error) {
    throw new Error(
      `[screen-research] SavedScreen ${row.id} cannot migrate: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function assertDistinctSourceIds(
  screens: PreparedScreenConversation[],
  saved: PreparedSavedScreen[],
): void {
  const seen = new Set<string>();
  for (const source of [...screens, ...saved]) {
    if (seen.has(source.id)) {
      throw new Error(`[screen-research] duplicate legacy source id ${source.id}`);
    }
    seen.add(source.id);
  }
}

async function migrateConversation(
  transaction: Prisma.TransactionClient,
  source: PreparedScreenConversation,
  counts: MutableMigrationCounts,
  hasScreenConversationRelation: boolean,
): Promise<string | null> {
  const linked = hasScreenConversationRelation
    ? await transaction.$queryRawUnsafe<LinkedConversationRow[]>(
        'SELECT "id", "userId", "surface" FROM "AgentConversation" WHERE "screenConversationId" = ? ORDER BY "id"',
        source.id,
      )
    : [];
  if (linked.length > 1) {
    throw new Error(
      `[screen-research] ScreenConversation ${source.id} has ${linked.length} linked AgentConversation rows`,
    );
  }
  let target = await transaction.agentConversation.findUnique({ where: { id: source.id } });
  const linkedConversation = linked[0];
  if (linkedConversation) {
    assertLegacyConversationOwner(source, linkedConversation);
  }
  if (target && linkedConversation?.id === target.id) {
    throw new Error(`[screen-research] legacy and Research conversations share id ${source.id}`);
  }
  if (!target) {
    await transaction.agentConversation.create({
      data: {
        id: source.id,
        userId: source.userId,
        surface: 'research',
        title: source.title,
        createdAt: source.createdAt,
        updatedAt: source.updatedAt,
      },
    });
    counts.createdConversations += 1;
    target = await transaction.agentConversation.findUniqueOrThrow({ where: { id: source.id } });
  } else {
    counts.reusedConversations += 1;
  }
  assertTargetOwner(source.id, source.userId, target.userId, target.surface, ['research']);

  const linkedMessages = linkedConversation
    ? await transaction.agentMessage.findMany({
        where: { conversationId: linkedConversation.id },
        orderBy: { sequence: 'asc' },
      })
    : [];
  const migratedLinked = linkedMessages.map(
    (message) => migrateScreenMessage({ role: message.role, parts: message.parts }).message,
  );
  if (linkedConversation) {
    assertCompatibleMessageHistory(source.id, source.messages, migratedLinked);
    counts.movedTurns += await rawUpdateCount(
      transaction,
      'UPDATE "AgentTurn" SET "conversationId" = ? WHERE "conversationId" = ?',
      source.id,
      linkedConversation.id,
    );
  }

  const existingMessages = await transaction.agentMessage.findMany({
    where: { conversationId: source.id },
    orderBy: { sequence: 'asc' },
  });
  const migratedExisting = existingMessages.map((message) => ({
    row: message,
    migrated: migrateScreenMessage({ role: message.role, parts: message.parts }).message,
  }));
  for (const message of migratedExisting) {
    if (!sameParts(message.row.parts, message.migrated.parts)) {
      await transaction.agentMessage.update({
        where: { id: message.row.id },
        data: {
          parts: message.migrated.parts as unknown as Prisma.InputJsonValue,
          ...(message.row.turnId === null && linkedMessages[message.row.sequence]?.turnId
            ? { turnId: linkedMessages[message.row.sequence]?.turnId }
            : {}),
        },
      });
    } else if (message.row.turnId === null && linkedMessages[message.row.sequence]?.turnId) {
      await transaction.agentMessage.update({
        where: { id: message.row.id },
        data: { turnId: linkedMessages[message.row.sequence]?.turnId },
      });
    }
  }
  assertCompatibleMessageHistory(
    source.id,
    source.messages,
    migratedExisting.map((item) => item.migrated),
  );
  if (source.messages.length > existingMessages.length) {
    const missing = source.messages.slice(existingMessages.length);
    await transaction.agentMessage.createMany({
      data: missing.map((message, index) => ({
        id: ulid(),
        conversationId: source.id,
        role: message.role,
        parts: message.parts as unknown as Prisma.InputJsonValue,
        sequence: existingMessages.length + index,
        createdAt: source.updatedAt,
        ...(linkedMessages[existingMessages.length + index]?.turnId
          ? { turnId: linkedMessages[existingMessages.length + index]?.turnId }
          : {}),
      })),
    });
    counts.appendedMessages += missing.length;
  }
  return linkedConversation?.id ?? null;
}

async function migrateSavedScreen(
  transaction: Prisma.TransactionClient,
  source: PreparedSavedScreen,
  counts: MutableMigrationCounts,
): Promise<void> {
  let target = await transaction.agentConversation.findUnique({ where: { id: source.id } });
  if (!target) {
    target = await transaction.agentConversation.create({
      data: {
        id: source.id,
        userId: source.userId,
        surface: 'research',
        title: source.name,
        createdAt: source.createdAt,
        updatedAt: source.updatedAt,
      },
    });
    counts.createdConversations += 1;
  } else {
    counts.reusedConversations += 1;
  }
  assertTargetOwner(source.id, source.userId, target.userId, target.surface, ['research']);

  const universePart: UniversePart = {
    type: 'universe',
    title: source.name,
    spec: source.universe,
  };
  const first = await transaction.agentMessage.findFirst({
    where: { conversationId: source.id },
    orderBy: { sequence: 'asc' },
  });
  if (!first) {
    await transaction.agentMessage.create({
      data: {
        id: ulid(),
        conversationId: source.id,
        role: 'assistant',
        parts: [universePart] as unknown as Prisma.InputJsonValue,
        sequence: 0,
        createdAt: source.updatedAt,
      },
    });
    counts.appendedMessages += 1;
  } else {
    const parts = parseJson(first.parts);
    if (
      first.sequence !== 0 ||
      first.role !== 'assistant' ||
      !Array.isArray(parts) ||
      parts[0]?.type !== 'universe'
    ) {
      throw new Error(`[screen-research] target id collision for SavedScreen ${source.id}`);
    }
    await transaction.agentMessage.update({
      where: { id: first.id },
      data: { parts: [universePart] as unknown as Prisma.InputJsonValue },
    });
  }
}

async function verifyMigration(
  transaction: Prisma.TransactionClient,
  screens: PreparedScreenConversation[],
  saved: PreparedSavedScreen[],
): Promise<void> {
  for (const screen of screens) {
    const target = await transaction.agentConversation.findUnique({
      where: { id: screen.id },
      include: { messages: { orderBy: { sequence: 'asc' } } },
    });
    if (!target || target.userId !== screen.userId || target.surface !== 'research') {
      throw new Error(`[screen-research] verification failed for ScreenConversation ${screen.id}`);
    }
    const targetMessages = target.messages.map(
      (message) => migrateScreenMessage({ role: message.role, parts: message.parts }).message,
    );
    assertCompatibleMessageHistory(screen.id, screen.messages, targetMessages);
  }
  for (const source of saved) {
    const target = await transaction.agentConversation.findUnique({
      where: { id: source.id },
      include: { messages: { orderBy: { sequence: 'asc' }, take: 1 } },
    });
    const part = parseJson(target?.messages[0]?.parts);
    if (
      !target ||
      target.userId !== source.userId ||
      target.surface !== 'research' ||
      !Array.isArray(part) ||
      part[0]?.type !== 'universe' ||
      !sameParts(part[0]?.spec, source.universe)
    ) {
      throw new Error(`[screen-research] verification failed for SavedScreen ${source.id}`);
    }
  }
}

function assertLegacyConversationOwner(
  source: PreparedScreenConversation,
  linked: LinkedConversationRow,
): void {
  if (linked.userId !== source.userId || linked.surface !== 'screen') {
    throw new Error(`[screen-research] invalid linked conversation ${linked.id} for ${source.id}`);
  }
}

function assertTargetOwner(
  id: string,
  sourceUserId: string,
  userId: string,
  surface: string,
  allowedSurfaces: string[],
): void {
  if (userId !== sourceUserId || !allowedSurfaces.includes(surface)) {
    throw new Error(`[screen-research] target id collision for ${id}`);
  }
}

class DryRunRollback extends Error {
  public constructor(public readonly counts: MutableMigrationCounts) {
    super('screen-to-research dry run rollback');
  }
}

function assertCompatibleMessageHistory(
  sourceId: string,
  source: ChatMessage[],
  target: ChatMessage[],
): void {
  const commonLength = Math.min(source.length, target.length);
  for (let index = 0; index < commonLength; index++) {
    if (
      source[index]?.role !== target[index]?.role ||
      !sameParts(source[index]?.parts, target[index]?.parts)
    ) {
      throw new Error(
        `[screen-research] divergent message ${index} in ScreenConversation ${sourceId}`,
      );
    }
  }
}

async function rawUpdateCount(
  transaction: Prisma.TransactionClient,
  sql: string,
  ...values: unknown[]
): Promise<number> {
  return transaction.$executeRawUnsafe(sql, ...values);
}

async function tableExists(database: PrismaClient, table: string): Promise<boolean> {
  const rows = await database.$queryRawUnsafe<Array<{ count: bigint | number }>>(
    'SELECT COUNT(*) AS "count" FROM sqlite_master WHERE type = ? AND name = ?',
    'table',
    table,
  );
  return Number(rows[0]?.count ?? 0) === 1;
}

async function tableRowCount(database: PrismaClient, table: string): Promise<number> {
  const escaped = table.replaceAll('"', '""');
  const rows = await database.$queryRawUnsafe<Array<{ count: bigint | number }>>(
    `SELECT COUNT(*) AS "count" FROM "${escaped}"`,
  );
  return Number(rows[0]?.count ?? 0);
}

async function columnExists(
  database: PrismaClient,
  table: string,
  column: string,
): Promise<boolean> {
  const rows = await database.$queryRawUnsafe<Array<{ name: string }>>(
    `PRAGMA table_info("${table.replaceAll('"', '""')}")`,
  );
  return rows.some((row) => row.name === column);
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function sameParts(left: unknown, right: unknown): boolean {
  return JSON.stringify(parseJson(left)) === JSON.stringify(parseJson(right));
}

function toDate(value: Date | string | number): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`[screen-research] invalid legacy date ${String(value)}`);
  }
  return date;
}

function emptySummary(args: {
  sourceTablesPresent: boolean;
  deferred: boolean;
  dryRun: boolean;
  finalize: boolean;
}): ScreenDataMigrationSummary {
  return {
    ...args,
    screenConversations: 0,
    savedScreens: 0,
    createdConversations: 0,
    reusedConversations: 0,
    movedTurns: 0,
    appendedMessages: 0,
    removedLegacyConversations: 0,
    convertedCards: 0,
  };
}
