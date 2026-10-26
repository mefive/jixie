import { COMMODITY_MAIN_CONTRACT_SPECS } from '#market/commodity/commodity-futures.js';
import { datasetInputReadiness } from '#market/synchronization/readiness.js';
import { MarketSourcePendingError } from '#market/errors.js';
import type { Prisma, MarketCalculationState } from '@prisma/client';
import { getDatabase } from '#infra/database/prisma.js';
import { withMarketAccess, withMarketPublication } from '#infra/coordination/market-access.js';
import type { AcceptedMarketChange, MarketPartition } from '#market/synchronization/partition.js';
import { marketRevision } from '#market/synchronization/readiness.js';
import { computeCommodityContinuousReturns } from '#market/commodity/commodity-continuous-returns.js';
import { publishFutureMarketDate } from '#market/futures/publication.js';

// 保持其他派生任务的已有版本身份，避免天气删除触发无关重算。
// Preserve existing version identities for the remaining derived tasks.
export const MARKET_CALCULATION_VERSION = 'market-state-sync-v2';
export const MARKET_AUDIT_VERSION = 'market-eligibility-v3';

function materiallyChanged(change: AcceptedMarketChange, fields: readonly string[]): boolean {
  return (
    !change.before ||
    !change.after ||
    fields.some((field) => change.before![field] !== change.after![field])
  );
}

/**
 * 变更前后序列共同决定有界滚动传播，较早目标不截断已存在的未来输出。
 *
 * Before/after sequences bound rolling propagation; earlier targets never clip existing later
 * outputs.
 */
export async function invalidateMarketCalculations(
  transaction: Prisma.TransactionClient,
  changes: AcceptedMarketChange[],
): Promise<void> {
  const commodityDates = new Set<string>();
  const futureDates = new Set<string>();

  for (const change of changes) {
    const row = change.after ?? change.before!;
    const date =
      typeof row.tradeDate === 'string'
        ? row.tradeDate
        : typeof row.calDate === 'string'
          ? row.calDate
          : null;
    if (
      ['FutureDaily', 'FutureMapping', 'FutureSettlement'].includes(change.table) &&
      date &&
      materiallyChanged(
        change,
        change.table === 'FutureMapping'
          ? ['continuousCode', 'tradeDate', 'mappedTsCode']
          : [
              'tsCode',
              'tradeDate',
              'open',
              'high',
              'low',
              'close',
              'settle',
              'volume',
              'amount',
              'openInterest',
              'longMarginRate',
              'shortMarginRate',
            ],
      )
    ) {
      const identity = String(row.tsCode ?? row.continuousCode);
      if (/^(IF|IH|IC|IM)(?:\d|\.)/.test(identity)) {
        futureDates.add(date);
      } else if (
        change.table !== 'FutureSettlement' &&
        materiallyChanged(change, change.table === 'FutureMapping' ? ['mappedTsCode'] : ['settle'])
      ) {
        commodityDates.add(date);
      }
      const product = identity.match(/^[A-Za-z]+/)?.[0].toUpperCase();
      const next = await transaction.futureMapping.findFirst({
        where: { continuousCode: { startsWith: `${product}.` }, tradeDate: { gt: date } },
        orderBy: { tradeDate: 'asc' },
        select: { tradeDate: true },
      });
      if (next && commodityDates.has(date)) {
        commodityDates.add(next.tradeDate);
      }
    }
  }

  for (const [kind, affected] of [
    ['commodity-continuous', commodityDates],
    ['future-publication', futureDates],
  ] as const) {
    for (const date of affected) {
      const previous = await transaction.marketCalculationState.findUnique({
        where: { kind_scope_date: { kind, scope: 'all', date } },
      });
      const dirtyScopes = [
        ...new Set([
          ...(Array.isArray(previous?.dirtyScopes)
            ? previous.dirtyScopes.filter((value): value is string => typeof value === 'string')
            : []),
          'all',
        ]),
      ];
      await transaction.marketCalculationState.upsert({
        where: { kind_scope_date: { kind, scope: 'all', date } },
        create: {
          kind,
          scope: 'all',
          date,
          status: 'stale',
          dirtyScopes,
          calculationVersion: MARKET_CALCULATION_VERSION,
          auditVersion: MARKET_AUDIT_VERSION,
        },
        update: {
          status: 'stale',
          dirtyScopes,
          nextAttemptAt: null,
          generation: { increment: 1 },
          error: null,
        },
      });
    }
  }
}

/**
 * 覆盖资格变化使仍保留的期货发布与商品收益失效。
 *
 * Proof changes invalidate the remaining futures publication and commodity-return outputs.
 */
export async function invalidatePartitionCoverage(
  transaction: Prisma.TransactionClient,
  partition: MarketPartition,
): Promise<void> {
  const kind = partition.dataset.startsWith('future-')
    ? 'future-publication'
    : ['commodity-prices', 'commodity-mappings'].includes(partition.dataset)
      ? 'commodity-continuous'
      : null;
  if (!kind) {
    return;
  }

  const dates = await transaction.marketCalculationState.findMany({
    where: {
      kind,
      date: { gte: partition.startDate, lte: partition.endDate },
    },
    select: { date: true },
  });

  for (const { date } of dates) {
    const previous = await transaction.marketCalculationState.findUnique({
      where: { kind_scope_date: { kind, scope: 'all', date } },
    });
    const dirtyScopes = [
      ...new Set([
        ...(Array.isArray(previous?.dirtyScopes)
          ? previous.dirtyScopes.filter((value): value is string => typeof value === 'string')
          : []),
        'all',
      ]),
    ];

    await transaction.marketCalculationState.upsert({
      where: { kind_scope_date: { kind, scope: 'all', date } },
      create: {
        kind,
        scope: 'all',
        date,
        status: 'stale',
        dirtyScopes,
        calculationVersion: MARKET_CALCULATION_VERSION,
        auditVersion: MARKET_AUDIT_VERSION,
      },
      update: {
        status: 'stale',
        dirtyScopes,
        nextAttemptAt: null,
        generation: { increment: 1 },
      },
    });
  }
}

export interface RefreshMarketCalculationsInput {
  targetDate: string;
  limit: number;
  signal?: AbortSignal;
}

/**
 * 刷新保留的期货发布和商品收益任务，不自动重跑用户策略。
 *
 * Refresh remaining futures publication and commodity-return tasks without rerunning user strategies.
 */
export async function refreshMarketCalculations(input: RefreshMarketCalculationsInput) {
  const database = getDatabase();
  await prepareCalculationTasks(input.limit);
  const pending = await database.marketCalculationState.findMany({
    where: {
      status: { not: 'ready' },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
    },
    orderBy: [{ status: 'asc' }, { date: 'desc' }, { kind: 'asc' }],
    take: input.limit,
  });
  const attempted = { ready: 0, waiting: 0, errors: 0 };

  for (const state of pending) {
    if (input.signal?.aborted) {
      break;
    }

    try {
      const revision = await marketRevision();
      let status: 'ready' | 'waiting';
      switch (state.kind) {
        case 'future-publication':
          status = await refreshFuturePublication(state, revision, input.signal);
          break;
        case 'commodity-continuous':
          status = await refreshCommodityCalculation(state, revision, input.signal);
          break;
        default:
          throw new Error(`Unknown market calculation kind ${state.kind}`);
      }
      attempted[status]++;
    } catch (error) {
      if (input.signal?.aborted) {
        break;
      }
      const waiting = error instanceof MarketSourcePendingError;
      attempted[waiting ? 'waiting' : 'errors']++;
      await database.marketCalculationState.updateMany({
        where: {
          kind: state.kind,
          scope: state.scope,
          date: state.date,
          generation: state.generation,
        },
        data: {
          status: waiting ? 'waiting' : 'error',
          nextAttemptAt: new Date(Date.now() + (waiting ? 3600_000 : 300_000)),
          error: error instanceof Error ? error.message : String(error),
          checkedAt: new Date(),
        },
      });
    }
  }

  return { ready: attempted.ready, ...(await readMarketCalculationBacklog()), attempted };
}

/**
 * 未解决状态独立于本轮尝试预算；较早目标造成的后续失效也属于同步待办。
 *
 * Durable unresolved states survive attempt budgets, including later outputs invalidated by revisions.
 */
export async function readMarketCalculationBacklog() {
  const states = await getDatabase().marketCalculationState.groupBy({
    by: ['status'],
    where: {
      kind: { not: 'market-state' },
      status: { in: ['waiting', 'error', 'stale'] },
    },
    _count: true,
  });

  return {
    waiting: states.find((state) => state.status === 'waiting')?._count ?? 0,
    errors: states.find((state) => state.status === 'error')?._count ?? 0,
    stale: states.find((state) => state.status === 'stale')?._count ?? 0,
  };
}

async function prepareCalculationTasks(limit: number): Promise<void> {
  const database = getDatabase();
  await withMarketPublication(() =>
    database.$transaction(async (transaction) => {
      // 清理已退役天气任务，避免旧状态进入维护重试。
      // Retire weather tasks before the remaining maintenance calculations are prepared.
      await transaction.marketCalculationState.deleteMany({ where: { kind: 'market-state' } });

      const invalidated = await transaction.marketCalculationState.updateMany({
        where: {
          OR: [
            { calculationVersion: { not: MARKET_CALCULATION_VERSION } },
            { auditVersion: { not: MARKET_AUDIT_VERSION } },
          ],
        },
        data: {
          status: 'stale',
          dirtyScopes: ['all'],
          nextAttemptAt: null,
          generation: { increment: 1 },
          calculationVersion: MARKET_CALCULATION_VERSION,
          auditVersion: MARKET_AUDIT_VERSION,
        },
      });
      if (invalidated.count) {
        await transaction.marketDataState.update({
          where: { key: 'global' },
          data: { revision: { increment: 1 } },
        });
      }
    }),
  );

  for (const kind of ['commodity-continuous', 'future-publication']) {
    const stored = await database.marketCalculationState.findMany({
      where: { kind },
      select: { date: true },
    });
    const where = { tradeDate: { notIn: stored.map((state) => state.date) } };
    const rows =
      kind === 'commodity-continuous'
        ? await database.commodityContinuousReturn.groupBy({
            by: ['tradeDate'],
            where,
            orderBy: { tradeDate: 'desc' },
            take: limit,
          })
        : await database.futureMarketPublication.findMany({
            where,
            orderBy: { tradeDate: 'desc' },
            take: limit,
            select: { tradeDate: true },
          });
    for (const row of rows) {
      await database.marketCalculationState.upsert({
        where: { kind_scope_date: { kind, scope: 'all', date: row.tradeDate } },
        create: {
          kind,
          scope: 'all',
          date: row.tradeDate,
          status: 'stale',
          calculationVersion: MARKET_CALCULATION_VERSION,
          auditVersion: MARKET_AUDIT_VERSION,
        },
        update: {},
      });
    }
  }
}

interface CalculationPublication {
  status: 'ready' | 'waiting';
  gaps: string[];
  inputVersions?: Prisma.InputJsonValue;
}

/**
 * 同一事务核对输入修订和失效代次，发布输出后原子记录 ready。
 *
 * Verify input revision and invalidation generation, then atomically publish outputs and readiness.
 */
async function publishCalculation(
  state: MarketCalculationState,
  revision: number,
  operation: (transaction: Prisma.TransactionClient) => Promise<CalculationPublication>,
): Promise<'ready' | 'waiting'> {
  const database = getDatabase();

  return withMarketPublication(() =>
    database.$transaction(
      async (transaction) => {
        const where = {
          kind_scope_date: { kind: state.kind, scope: state.scope, date: state.date },
        };
        const current = await transaction.marketCalculationState.findUniqueOrThrow({ where });
        const inputs = await transaction.marketDataState.findUniqueOrThrow({
          where: { key: 'global' },
        });
        if (
          current.generation !== state.generation ||
          inputs.revision !== revision ||
          current.calculationVersion !== state.calculationVersion ||
          current.auditVersion !== state.auditVersion
        ) {
          throw new Error(`Stale calculation completion: ${state.kind}/${state.date}`);
        }

        const publication = await operation(transaction);
        await transaction.marketDataState.update({
          where: { key: 'global' },
          data: { revision: { increment: 1 } },
        });
        await transaction.marketCalculationState.update({
          where,
          data: {
            ...publication,
            readyGeneration: state.generation,
            inputRevision: revision,
            dirtyScopes: [],
            nextAttemptAt:
              publication.status === 'waiting' ? new Date(Date.now() + 3600_000) : null,
            checkedAt: new Date(),
            error: null,
            calculationVersion: MARKET_CALCULATION_VERSION,
            auditVersion: MARKET_AUDIT_VERSION,
          },
        });

        return publication.status;
      },
      { timeout: 60_000 },
    ),
  );
}

async function refreshFuturePublication(
  state: MarketCalculationState,
  revision: number,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();

  return publishCalculation(state, revision, async (transaction) => {
    await publishFutureMarketDate(state.date, transaction);

    return { status: 'ready', gaps: [] };
  });
}

async function refreshCommodityCalculation(
  state: MarketCalculationState,
  revision: number,
  signal?: AbortSignal,
): Promise<'ready' | 'waiting'> {
  const points = await withMarketAccess(async () => {
    const candidates = await computeCommodityContinuousReturns(state.date, state.date);
    const eligible: typeof candidates = [];
    for (const point of candidates) {
      signal?.throwIfAborted();
      const proof = await datasetInputReadiness([
        {
          dataset: 'commodity-mappings',
          scope: point.continuousCode,
          startDate: point.previousTradeDate,
          endDate: point.tradeDate,
        },
        ...[point.mappedContract, point.previousMappedContract].map((scope) => ({
          dataset: 'commodity-prices',
          scope,
          startDate: point.previousTradeDate,
          endDate: point.tradeDate,
        })),
      ]);
      if (proof.ready) {
        eligible.push(point);
      }
    }

    return eligible;
  });
  signal?.throwIfAborted();
  if (!points.length) {
    await getDatabase().marketCalculationState.updateMany({
      where: {
        kind: state.kind,
        scope: state.scope,
        date: state.date,
        generation: state.generation,
      },
      data: {
        status: 'waiting',
        nextAttemptAt: new Date(Date.now() + 3600_000),
        gaps: ['No eligible same-contract settlement pair'],
        checkedAt: new Date(),
      },
    });

    return 'waiting';
  }

  const missingProducts = COMMODITY_MAIN_CONTRACT_SPECS.filter(
    (specification) =>
      specification.startDate < state.date &&
      !points.some((point) => point.productCode === specification.productCode),
  ).map((specification) => specification.productCode);

  return publishCalculation(state, revision, async (transaction) => {
    await transaction.commodityContinuousReturn.deleteMany({
      where: {
        tradeDate: state.date,
        productCode: { in: points.map((point) => point.productCode) },
      },
    });
    await transaction.commodityContinuousReturn.createMany({
      data: points.map((point) => ({ ...point, retrievedAt: new Date() })),
    });

    return {
      status: missingProducts.length ? 'waiting' : 'ready',
      inputVersions: { readyProducts: points.map((point) => point.productCode) },
      gaps: missingProducts.map((product) => `${product}: missing qualified settlement pair`),
    };
  });
}
