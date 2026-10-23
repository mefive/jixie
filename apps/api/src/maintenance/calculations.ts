import { COMMODITY_MAIN_CONTRACT_SPECS } from '#market/commodity/commodity-futures.js';
import { datasetInputReadiness } from '#market/synchronization/readiness.js';
import { allMarketIndicatorScope, dirtyMarketIndicatorScope } from '#market/state/scope.js';
import { MarketSourcePendingError } from '#market/errors.js';
import type { Prisma, MarketCalculationState } from '@prisma/client';
import { getDatabase } from '#infra/database/prisma.js';
import { withMarketAccess, withMarketPublication } from '#infra/coordination/market-access.js';
import type { AcceptedMarketChange, MarketPartition } from '#market/synchronization/partition.js';
import { marketRevision } from '#market/synchronization/readiness.js';
import { prepareMarketIndicators, publishMarketIndicators } from '#market/state/prepare.js';
import { computeCommodityContinuousReturns } from '#market/commodity/commodity-continuous-returns.js';
import { publishFutureMarketDate } from '#market/futures/publication.js';

import {
  MARKET_CALCULATION_VERSION,
  MARKET_AUDIT_VERSION,
  MARKET_INDICATOR_INPUT_FIELDS,
} from '#market/state/eligibility.js';

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
  const dates = new Set<string>();
  const scopeByDate = new Map<string, Set<string>>();
  let changedScope = 'all';
  const addDate = (date: string) => {
    dates.add(date);
    const scopes = scopeByDate.get(date) ?? new Set<string>();
    scopes.add(changedScope);
    scopeByDate.set(date, scopes);
  };
  const commodityDates = new Set<string>();
  const futureDates = new Set<string>();
  const stored = await transaction.marketCalculationState.findMany({
    where: { kind: 'market-state' },
    select: { date: true },
  });
  const outputDates = [...new Set(stored.map((state) => state.date))].sort();
  const addRange = (start: string, end: string) => {
    addDate(start);
    for (const date of outputDates) {
      if (date >= start && date <= end) {
        addDate(date);
      }
    }
  };
  for (const change of changes) {
    changedScope =
      change.table === 'IndexWeight'
        ? `index:${String((change.after ?? change.before!).indexCode)}`
        : change.table === 'IndexDaily'
          ? `index:${String((change.after ?? change.before!).tsCode)}`
          : change.table === 'SwIndustryMember'
            ? 'industries'
            : 'all';
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
    if (
      change.table === 'IndexDaily' &&
      !allMarketIndicatorScope().indexCodes.includes(String(row.tsCode))
    ) {
      continue;
    }
    const fields = MARKET_INDICATOR_INPUT_FIELDS[change.table];
    if (!fields || !materiallyChanged(change, fields)) {
      continue;
    }
    if (change.table === 'SwIndustryMember') {
      const start = [change.before?.inDate, change.after?.inDate]
        .filter((value): value is string => typeof value === 'string')
        .sort()[0];
      const end = [change.before?.outDate, change.after?.outDate].some((value) => value == null)
        ? (outputDates.at(-1) ?? start)
        : [String(change.before?.outDate ?? ''), String(change.after?.outDate ?? '')]
            .sort()
            .at(-1)!;
      addRange(start, end);
      continue;
    }
    if (
      change.table === 'TradeCal' &&
      (!date ||
        (row.isOpen !== 1 && change.before?.isOpen !== 1) ||
        (!outputDates.includes(date) &&
          !(await transaction.daily.count({ where: { tradeDate: date } }))))
    ) {
      continue;
    }
    if (!date || (change.table === 'TradeCal' && row.exchange !== 'SSE')) {
      continue;
    }
    if (change.table === 'IndexWeight') {
      const next = await transaction.indexWeight.findFirst({
        where: { indexCode: String(row.indexCode), tradeDate: { gt: date } },
        orderBy: { tradeDate: 'asc' },
        select: { tradeDate: true },
      });
      addRange(date, next?.tradeDate ?? outputDates.at(-1) ?? date);
      continue;
    }
    if (
      ['Daily', 'AdjFactor', 'IndexDaily', 'TradeCal'].includes(change.table) &&
      outputDates.some((output) => output > date)
    ) {
      const following = change.table === 'IndexDaily' ? 20 : 59;
      const sessions =
        change.table === 'IndexDaily' || change.table === 'TradeCal'
          ? (
              await transaction.tradeCal.findMany({
                where: { exchange: 'SSE', isOpen: 1, calDate: { gt: date } },
                orderBy: { calDate: 'asc' },
                take: change.table === 'IndexDaily' ? following : 60,
                select: { calDate: true },
              })
            ).map((entry) => ({ tradeDate: entry.calDate }))
          : await transaction.daily.findMany({
              where: { tsCode: String(row.tsCode), tradeDate: { gt: date } },
              orderBy: { tradeDate: 'asc' },
              take: following,
              select: { tradeDate: true },
            });
      addRange(date, sessions.at(-1)?.tradeDate ?? date);
    } else {
      addDate(date);
    }
  }
  for (const [kind, affected] of [
    ['market-state', dates],
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
          ...(scopeByDate.get(date) ?? ['all']),
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
 * 覆盖资格变化也能使旧输出失效；指数延伸二十个交易日，SSE 日历覆盖六十日窗口。
 *
 * Proof changes invalidate unchanged values too: twenty following index sessions and the sixty-session
 * window that depends on SSE calendar proof.
 */
export async function invalidatePartitionCoverage(
  transaction: Prisma.TransactionClient,
  partition: MarketPartition,
): Promise<void> {
  const stock = ['stock-prices', 'stock-adjustments', 'stock-valuations', 'stock-limits'].includes(
    partition.dataset,
  );
  const indexPrices = partition.dataset === 'index-prices';
  const calendar = partition.dataset === 'calendar' && partition.scope === 'SSE';
  const market =
    stock ||
    calendar ||
    ['index-prices', 'index-weights', 'industry-members'].includes(partition.dataset);
  const kind = market
    ? 'market-state'
    : partition.dataset.startsWith('future-')
      ? 'future-publication'
      : ['commodity-prices', 'commodity-mappings'].includes(partition.dataset)
        ? 'commodity-continuous'
        : null;
  if (!kind) {
    return;
  }

  const following =
    stock || indexPrices || calendar
      ? await transaction.tradeCal.findMany({
          where: { exchange: 'SSE', isOpen: 1, calDate: { gt: partition.endDate } },
          orderBy: { calDate: 'asc' },
          take: indexPrices ? 20 : calendar ? 59 : 60,
          select: { calDate: true },
        })
      : [];
  const dates = await transaction.marketCalculationState.findMany({
    where: {
      kind,
      date: { gte: partition.startDate, lte: following.at(-1)?.calDate ?? partition.endDate },
    },
    select: { date: true },
  });
  if (
    stock &&
    partition.startDate === partition.endDate &&
    !dates.some((state) => state.date === partition.startDate)
  ) {
    dates.push({ date: partition.startDate });
  }

  for (const { date } of dates) {
    const previous = await transaction.marketCalculationState.findUnique({
      where: { kind_scope_date: { kind, scope: 'all', date } },
    });
    const dirtyScopes = [
      ...new Set([
        ...(Array.isArray(previous?.dirtyScopes)
          ? previous.dirtyScopes.filter((value): value is string => typeof value === 'string')
          : []),
        indexPrices ? `index:${partition.scope}` : 'all',
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
 * 新输入和版本变化使当前看板失效，不修改持久用户报告或自动重跑用户策略。
 *
 * New inputs and versions invalidate current dashboards, never persisted user reports or arbitrary
 * strategies.
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
        case 'market-state':
          status = await refreshIndicatorCalculation(state, revision, input.signal);
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
  const existingDates = await database.marketCalculationState.findMany({
    where: { kind: 'market-state' },
    select: { date: true },
  });
  const legacy = await database.marketIndicator.findMany({
    where: { tradeDate: { notIn: existingDates.map((state) => state.date) } },
    orderBy: { tradeDate: 'desc' },
    take: limit,
    select: { tradeDate: true },
  });
  for (const row of legacy) {
    await database.marketCalculationState.upsert({
      where: { kind_scope_date: { kind: 'market-state', scope: 'all', date: row.tradeDate } },
      create: {
        kind: 'market-state',
        scope: 'all',
        date: row.tradeDate,
        status: 'stale',
        dirtyScopes: ['all'],
        calculationVersion: MARKET_CALCULATION_VERSION,
        auditVersion: MARKET_AUDIT_VERSION,
      },
      update: {},
    });
  }
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

async function refreshIndicatorCalculation(
  state: MarketCalculationState,
  revision: number,
  signal?: AbortSignal,
) {
  const scope = dirtyMarketIndicatorScope(state.dirtyScopes);
  const prepared = await withMarketAccess(() => prepareMarketIndicators(state.date, scope));
  signal?.throwIfAborted();
  const previous =
    state.inputVersions &&
    typeof state.inputVersions === 'object' &&
    !Array.isArray(state.inputVersions)
      ? state.inputVersions
      : null;
  const retained = Array.isArray(previous?.qualifiedScopes)
    ? previous.qualifiedScopes.filter(
        (value): value is string =>
          typeof value === 'string' &&
          !(value === 'market' && scope.market) &&
          !(value.startsWith('industry:') && scope.industries) &&
          !(value.startsWith('index:') && scope.indexCodes.includes(value.slice(6))),
      )
    : [];

  return publishCalculation(state, revision, async (transaction) => {
    await publishMarketIndicators(transaction, state.date, scope, prepared.outputs);

    return {
      status: prepared.gaps.length ? 'waiting' : 'ready',
      gaps: prepared.gaps,
      inputVersions: {
        groups: prepared.groups,
        qualifiedScopes: [...new Set([...retained, ...prepared.qualifiedScopes])],
      },
    };
  });
}
