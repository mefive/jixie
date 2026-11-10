import type { Prisma } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { PublicationPlan } from './publication-plan.js';
import {
  publicationTableWorkload,
  recordPublicationWork,
  type PublicationWorkload,
} from './publication-budget.js';
import { PublicationPlanError } from './errors.js';

const marketKeys = {
  tradeCal: ['exchange', 'calDate'],
  stockBasic: ['tsCode'],
  stockCodeChange: ['oldTsCode'],
  stockNameHistory: ['tsCode', 'startDate'],
  daily: ['tsCode', 'tradeDate'],
  adjFactor: ['tsCode', 'tradeDate'],
  dailyBasic: ['tsCode', 'tradeDate'],
  stkLimit: ['tsCode', 'tradeDate'],
  etfBasic: ['tsCode'],
  etfDaily: ['tsCode', 'tradeDate'],
  etfAdjFactor: ['tsCode', 'tradeDate'],
  indexBenchmark: ['tsCode'],
  indexDaily: ['tsCode', 'tradeDate'],
  indexDailyBasic: ['tsCode', 'tradeDate'],
  indexWeight: ['indexCode', 'conCode', 'tradeDate'],
  financialIncomeStatement: ['id'],
  financialBalanceSheet: ['id'],
  financialCashFlowStatement: ['id'],
  finaIndicator: ['tsCode', 'endDate'],
  finaIndicatorVersion: ['id'],
  dividend: ['id'],
  ingestionSelection: ['assetType'],
} as const satisfies Partial<Record<keyof Prisma.TransactionClient, readonly string[]>>;

type MarketModel = keyof typeof marketKeys;
const models = Object.keys(marketKeys) as MarketModel[];
const keySchema = z.array(z.string());

/**
 * 只在副本安装变更日志触发器，覆盖现有领域写入与修复事务。
 *
 * Install replica-only change capture for domain writes and repair transactions.
 */
export async function installReplicaJournal(transaction: Prisma.TransactionClient): Promise<void> {
  for (const model of models) {
    const table = model[0].toUpperCase() + model.slice(1);
    for (const operation of ['INSERT', 'UPDATE', 'DELETE'] as const) {
      const sources =
        operation === 'UPDATE' ? ['OLD', 'NEW'] : [operation === 'INSERT' ? 'NEW' : 'OLD'];
      const statements = sources.map((source) => {
        const columns = marketKeys[model].map((key) => `${source}."${key}"`).join(', ');
        const key = `json_array(${columns})`;
        // 外层 UPSERT 可能覆盖触发器的 OR IGNORE，先排除已登记键。
        // An outer UPSERT can override the trigger's OR IGNORE policy, so skip existing keys first.
        return `INSERT INTO "IngestionReplicaChange" ("model", "key")
          SELECT '${model}', ${key}
          WHERE NOT EXISTS (
            SELECT 1 FROM "IngestionReplicaChange" WHERE "model" = '${model}' AND "key" = ${key}
          );`;
      });
      // 仅静态白名单构造 SQLite DDL。 / Build SQLite DDL solely from the static allowlist.
      await transaction.$executeRawUnsafe(`CREATE TRIGGER IF NOT EXISTS "candidate_${table}_${operation}"
        AFTER ${operation} ON "${table}" BEGIN ${statements.join('\n')} END`);
    }
  }
}

type Key = Record<string, string>;
type Row = Record<string, unknown>;
type MarketDelegate = {
  findMany(input: { where: { OR: Key[] } }): Promise<Row[]>;
  createMany(input: { data: Row[] }): Promise<unknown>;
  update(input: { where: Record<string, string | Key>; data: Row }): Promise<unknown>;
  deleteMany(input: { where: { OR: Key[] } }): Promise<unknown>;
};

function delegate(database: Prisma.TransactionClient, model: MarketModel): MarketDelegate {
  // Prisma 的各表 delegate 均执行此处白名单内的标量读写。 / The allowlisted Prisma delegates share these scalar operations.
  return database[model] as unknown as MarketDelegate;
}

/**
 * 在主库事务外逐页比较并保存最终差异。
 *
 * Compare and spool final differences outside the main transaction.
 */
export async function prepareMarketPublication(
  replica: Prisma.TransactionClient,
  main: Prisma.TransactionClient,
  plan: PublicationPlan,
  signal?: AbortSignal,
): Promise<{ changes: number; workloads: PublicationWorkload[] }> {
  let changes = 0;
  const workloads: PublicationWorkload[] = [];
  for (const model of models) {
    let after: string | undefined;
    let scanned = 0;
    const columns = marketKeys[model];
    const keyOf = (row: Row) => JSON.stringify(columns.map((key) => row[key]));
    const { workload, indexedFields } = await publicationTableWorkload(main, model);
    workloads.push(workload);
    const source = delegate(replica, model);
    const destination = delegate(main, model);
    for (;;) {
      signal?.throwIfAborted();
      const page = await replica.ingestionReplicaChange.findMany({
        where: { model, ...(after === undefined ? {} : { key: { gt: after } }) },
        orderBy: { key: 'asc' },
        take: 100,
      });
      if (!page.length) {
        break;
      }
      after = page.at(-1)!.key;
      scanned += page.length;
      if (scanned % 100_000 === 0) {
        console.error(
          '[publication] preparing',
          JSON.stringify({ runId: plan.identity.runId, model, scanned }),
        );
      }
      const keys = page.map(({ key }) => {
        const values = keySchema.parse(JSON.parse(key));
        if (values.length !== columns.length) {
          throw new Error('Invalid replica journal key');
        }

        return Object.fromEntries(columns.map((column, index) => [column, values[index]]));
      });
      const where = { OR: keys };
      const wanted = new Map((await source.findMany({ where })).map((row) => [keyOf(row), row]));
      const existing = new Map(
        (await destination.findMany({ where })).map((row) => [keyOf(row), row]),
      );
      const inserted: Row[] = [];
      const updated: Array<{ key: Key; row: Row }> = [];
      const deleted: Key[] = [];
      for (const key of keys) {
        const identity = keyOf(key);
        const next = wanted.get(identity);
        const previous = existing.get(identity);
        if (isDeepStrictEqual(next, previous)) {
          continue;
        }
        changes++;
        if (!next) {
          deleted.push(key);
        } else if (!previous) {
          inserted.push(next);
        } else {
          updated.push({ key, row: next });
          if (
            [...indexedFields].some((field) => !isDeepStrictEqual(next[field], previous[field]))
          ) {
            workload.indexMutations += workload.indexCount;
          }
        }
      }
      recordPublicationWork(workload, 'inserted', inserted);
      recordPublicationWork(
        workload,
        'updated',
        updated.map(({ row }) => row),
      );
      recordPublicationWork(workload, 'deleted', deleted);
      if (inserted.length || updated.length || deleted.length) {
        await plan.append({ kind: 'market', model, inserted, updated, deleted });
      }
    }
  }

  return { changes, workloads };
}

const rowSchema = z.record(z.string(), z.unknown());
const keyObjectSchema = z.record(z.string(), z.string());
const marketChunkSchema = z.object({
  kind: z.literal('market'),
  model: z.string(),
  inserted: z.array(rowSchema),
  updated: z.array(z.object({ key: keyObjectSchema, row: rowSchema })),
  deleted: z.array(keyObjectSchema),
});

/**
 * 只应用清单，不再查询副库或比较主库记录。
 *
 * Apply the plan without reading candidates or comparing main records.
 */
export async function applyMarketPublicationChunk(
  main: Prisma.TransactionClient,
  value: unknown,
  signal?: AbortSignal,
) {
  const chunk = marketChunkSchema.parse(value);
  if (!Object.hasOwn(marketKeys, chunk.model)) {
    throw new PublicationPlanError('Unknown publication model');
  }
  const model = chunk.model as MarketModel;
  const columns = marketKeys[model];
  const destination = delegate(main, model);
  for (const { key, row } of chunk.updated) {
    signal?.throwIfAborted();
    await destination.update({
      where: columns.length === 1 ? key : { [columns.join('_')]: key },
      data: row,
    });
  }
  signal?.throwIfAborted();
  if (chunk.inserted.length) {
    await destination.createMany({ data: chunk.inserted });
  }
  if (chunk.deleted.length) {
    await destination.deleteMany({ where: { OR: chunk.deleted } });
  }
}
