import type { Prisma } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';

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

/** 逐页重放已冻结副本的最终业务值。 / Replay the frozen candidate's final values in bounded pages. */
export async function publishMarketChanges(
  replica: Prisma.TransactionClient,
  main: Prisma.TransactionClient,
  signal?: AbortSignal,
): Promise<number> {
  let changes = 0;
  for (const model of models) {
    let after: string | undefined;
    const columns = marketKeys[model];
    const keyOf = (row: Row) => JSON.stringify(columns.map((key) => row[key]));
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
          await destination.update({
            where: columns.length === 1 ? key : { [columns.join('_')]: key },
            data: next,
          });
        }
      }
      if (inserted.length) {
        await destination.createMany({ data: inserted });
      }
      if (deleted.length) {
        await destination.deleteMany({ where: { OR: deleted } });
      }
    }
  }

  return changes;
}
