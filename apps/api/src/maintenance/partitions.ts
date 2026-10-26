import { createHash } from 'node:crypto';
import { getDatabase } from '#infra/database/prisma.js';
import { DATASET_POLICIES } from '#market/synchronization/policies.js';
import { contiguousCoverage } from '#market/synchronization/coverage.js';
import type { DatasetPolicy, MarketPartition } from '#market/synchronization/partition.js';
import { calendarDay, localDate, localHour } from '#market/synchronization/date.js';
import { canonicalStockCode } from '#market/instruments/stock-identity.js';
import { ETF_RESEARCH_CODES } from '#market/registry/etf-research-registry.js';
import {
  DAILY_MAINTAINED_INDEX_CODES,
  MAJOR_INDEX_DAILY_BASIC_CODES,
  INDEX_MEMBERSHIP_CODES,
  SHENWAN_LEVEL_ONE_INDUSTRY_CODES,
} from '#market/registry/index-presets.js';
import { CROSS_MARKET_BENCHMARKS } from '#market/registry/cross-market-benchmarks.js';
import { EXTERNAL_FX_CODES } from '#market/registry/fx.js';
import {
  COMMODITY_FUTURE_SPECS,
  COMMODITY_HOLDING_SPECS,
} from '#market/commodity/commodity-futures.js';
import { CHINA_MACRO_SERIES } from '#market/macro/china-macro.js';

export const SYNC_LIMITS = {
  partitions: 240,
  requests: 600,
  calculations: 120,
  milliseconds: 30 * 60_000,
} as const;
export interface DatasetScope {
  scope: string;
  startDate: string;
  endDate?: string;
  calendar?: string;
  timeZone?: string;
  closeHour?: number;
}
export interface SyncRequirements {
  etfCodes: string[];
}
export interface PlannedPartition extends MarketPartition {
  id: string;
  policyVersion: string;
}
export interface PlanInput {
  targetDate: string;
  startedAt: Date;
  requirements: SyncRequirements;
  budget?: number;
  excludeIds?: ReadonlySet<string>;
  deadline?: number;
}

function scopes(policy: DatasetPolicy, names: readonly string[]): DatasetScope[] {
  return [...new Set(names)].map((scope) => ({ scope, startDate: policy.startDate }));
}

/**
 * 数据对象由既有目录和部署需求确定，不暴露用户选择器。
 *
 * Existing catalogs and deployment requirements determine objects without a public selector.
 */
export async function datasetScopes(
  policy: DatasetPolicy,
  requirements: SyncRequirements,
): Promise<DatasetScope[]> {
  switch (policy.dataset) {
    case 'calendar':
      return scopes(policy, ['SSE', 'SZSE', 'CFFEX', 'SHFE', 'INE', 'DCE']);
    case 'stock-master':
      return scopes(policy, ['L', 'D', 'P', 'G']);
    case 'stock-names':
      return scopes(policy, ['all']);
    case 'industry-members':
      return scopes(policy, SHENWAN_LEVEL_ONE_INDUSTRY_CODES);
    case 'index-catalog':
    case 'etf-master':
      return scopes(policy, ['all']);
    case 'index-prices':
      return scopes(policy, DAILY_MAINTAINED_INDEX_CODES);
    case 'index-valuations':
      return scopes(policy, MAJOR_INDEX_DAILY_BASIC_CODES);
    case 'index-weights':
      return scopes(policy, INDEX_MEMBERSHIP_CODES);
    case 'industry-prices':
      return scopes(policy, SHENWAN_LEVEL_ONE_INDUSTRY_CODES);
    case 'etf-prices':
    case 'etf-adjustments':
    case 'etf-shares': {
      const rows = await getDatabase().etfBasic.findMany({
        where: { tsCode: { in: [...new Set([...ETF_RESEARCH_CODES, ...requirements.etfCodes])] } },
      });
      return rows.map((row) => ({
        scope: row.tsCode,
        startDate: [
          row.listDate ?? '',
          ['510300.SH', '159920.SZ', '513500.SH'].includes(row.tsCode)
            ? '20120501'
            : ['159985.SZ', '159980.SZ', '159981.SZ'].includes(row.tsCode)
              ? '20191201'
              : policy.startDate,
        ]
          .filter(Boolean)
          .sort()
          .at(-1)!,
        endDate: row.delistDate ?? undefined,
      }));
    }
    case 'financial-statements':
      return scopes(
        policy,
        ['income', 'balance_sheet', 'cash_flow'].flatMap((kind) =>
          ['1', '4', '5'].map((reportType) => `${kind}|${reportType}`),
        ),
      );
    case 'financial-indicators':
      return scopes(policy, ['all']);
    case 'dividends': {
      const rows = await getDatabase().stockBasic.findMany({
        select: { tsCode: true, listDate: true },
      });
      const starts = new Map<string, string>();
      for (const row of rows) {
        const code = canonicalStockCode(row.tsCode);
        starts.set(code, [policy.startDate, row.listDate ?? policy.startDate].sort().at(-1)!);
      }
      return [...starts].map(([scope, startDate]) => ({ scope, startDate }));
    }
    case 'future-contracts':
      return scopes(
        policy,
        ['IF', 'IH', 'IC', 'IM'].map((code) => `CFFEX|${code}`),
      );
    case 'commodity-contracts':
      return scopes(
        policy,
        COMMODITY_FUTURE_SPECS.map((spec) => `${spec.exchange}|${spec.productCode}`),
      );
    case 'future-prices':
    case 'future-settlements':
    case 'commodity-prices': {
      const commodity = policy.dataset === 'commodity-prices';
      const rows = await getDatabase().futureContract.findMany({
        where: {
          productCode: {
            in: commodity
              ? COMMODITY_FUTURE_SPECS.map((spec) => spec.productCode)
              : ['IF', 'IH', 'IC', 'IM'],
          },
        },
      });
      return rows.map((row) => ({
        scope: row.tsCode,
        startDate: [row.listDate, policy.startDate].sort().at(-1)!,
        endDate: row.delistDate,
        calendar: row.exchange,
      }));
    }
    case 'future-mappings': {
      const contracts = await getDatabase().futureContract.groupBy({
        by: ['productCode'],
        where: { productCode: { in: ['IF', 'IH', 'IC', 'IM'] } },
        _min: { listDate: true },
      });

      return contracts.flatMap((contract) =>
        contract._min.listDate
          ? [
              {
                scope: `${contract.productCode}.CFX`,
                startDate: [policy.startDate, contract._min.listDate].sort().at(-1)!,
              },
            ]
          : [],
      );
    }
    case 'commodity-mappings':
      return COMMODITY_FUTURE_SPECS.map((spec) => ({
        scope: `${spec.productCode}.${{ SHFE: 'SHF', INE: 'INE', DCE: 'DCE' }[spec.exchange]}`,
        startDate: spec.productCode === 'SC' ? '20180326' : policy.startDate,
        calendar: spec.exchange,
      }));
    case 'commodity-holdings':
      return COMMODITY_HOLDING_SPECS.map((spec) => ({
        scope: spec.productCode,
        startDate: spec.startDate,
        calendar: spec.exchange,
      }));
    case 'commodity-receipts':
      return COMMODITY_FUTURE_SPECS.map((spec) => ({
        scope: spec.productCode,
        startDate: spec.warehouseReceipt.startDate,
        calendar: spec.exchange,
      }));
    case 'external-curves':
      return scopes(policy, ['nominal', 'real']);
    case 'external-fx':
      return scopes(policy, EXTERNAL_FX_CODES);
    case 'cross-market-benchmarks':
      return CROSS_MARKET_BENCHMARKS.map((definition) => ({
        scope: definition.id,
        startDate: policy.startDate,
        calendar: definition.calendarId,
        timeZone: definition.timeZone,
        closeHour: definition.market === 'HK' ? 17 : 16,
      }));
    case 'china-macro':
      return scopes(
        policy,
        CHINA_MACRO_SERIES.map((definition) => definition.sourceApi),
      );
    default:
      return scopes(policy, ['all']);
  }
}

function windowAt(
  cursor: string,
  end: string,
  period: DatasetPolicy['period'],
): { startDate: string; endDate: string } | null {
  if (cursor > end) {
    return null;
  }
  const year = Number(cursor.slice(0, 4));
  const month = Number(cursor.slice(4, 6));
  if (period === 'quarter') {
    const quarterEndMonth = Math.ceil(month / 3) * 3;
    const quarterEnd = new Date(Date.UTC(year, quarterEndMonth, 0))
      .toISOString()
      .slice(0, 10)
      .replaceAll('-', '');
    return quarterEnd <= end ? { startDate: quarterEnd, endDate: quarterEnd } : null;
  }
  const periodEnd =
    period === 'year'
      ? `${year}1231`
      : period === 'month'
        ? new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10).replaceAll('-', '')
        : cursor;

  return { startDate: cursor, endDate: periodEnd < end ? periodEnd : end };
}

function partitionId(partition: MarketPartition): string {
  return createHash('sha256')
    .update(
      JSON.stringify([partition.dataset, partition.scope, partition.startDate, partition.endDate]),
    )
    .digest('hex');
}

/**
 * 只在从游标开始已连续核验的日历区间内寻找下一交易日。
 *
 * Find the next session only inside calendar coverage verified continuously from the cursor.
 */
async function nextVerifiedSession(exchange: string, cursor: string, end: string) {
  const database = getDatabase();
  const proof = await database.datasetSyncPartition.findMany({
    where: {
      dataset: 'calendar',
      scope: exchange,
      status: 'complete',
      startDate: { lte: end },
      endDate: { gte: cursor },
    },
    select: { startDate: true, endDate: true },
  });
  const through = contiguousCoverage(cursor, proof);
  if (!through) {
    return { session: null, through: null };
  }
  const verifiedEnd = through < end ? through : end;
  const session = await database.tradeCal.findFirst({
    where: { exchange, isOpen: 1, calDate: { gte: cursor, lte: verifiedEnd } },
    orderBy: { calDate: 'asc' },
  });

  return { session, through: verifiedEnd };
}

/**
 * 计划游标仅表示已安排请求，完成事实只来自分区证据。
 *
 * Planning cursors mean scheduled requests; only partition evidence establishes completion.
 */
export async function planSyncPartitions(
  input: PlanInput,
): Promise<{ partitions: PlannedPartition[]; gaps: string[] }> {
  const database = getDatabase();
  const budget = input.budget ?? SYNC_LIMITS.partitions;
  const selected: PlannedPartition[] = [];
  const selectedIds = new Set<string>();
  const gaps: string[] = [];
  const select = async (partition: MarketPartition, policy: DatasetPolicy): Promise<boolean> => {
    partition = {
      dataset: partition.dataset,
      scope: partition.scope,
      startDate: partition.startDate,
      endDate: partition.endDate,
    };
    const id = partitionId(partition);
    if (
      (input.deadline && Date.now() >= input.deadline) ||
      input.excludeIds?.has(id) ||
      selectedIds.has(id) ||
      selected.length >= budget
    ) {
      return false;
    }
    const existing = await database.datasetSyncPartition.findUnique({ where: { id } });
    if (
      existing &&
      existing.policyVersion === policy.version &&
      existing.nextAttemptAt &&
      existing.nextAttemptAt > input.startedAt
    ) {
      return false;
    }
    await database.datasetSyncPartition.upsert({
      where: { id },
      create: { id, ...partition, policyVersion: policy.version, status: 'pending' },
      update: {},
    });
    selectedIds.add(id);
    selected.push({ id, ...partition, policyVersion: policy.version });

    return true;
  };
  const inventories = await loadInventories(input, gaps);
  const context: PlanningContext = { input, inventories, selected, select, gaps, budget };

  await planFreshPartitions(context);
  await planRecentPartitions(context);
  await planPendingPartitions(context);
  await planBackfillPartitions(context);
  await planDuePartitions(context);

  if (selected.length >= budget) {
    gaps.push('Finite acquisition batch budget reached; unfinished work remains durable');
  }

  return { partitions: selected, gaps };
}

async function loadInventories(input: PlanInput, gaps: string[]) {
  const database = getDatabase();
  const inventories = [];
  for (const policy of DATASET_POLICIES) {
    const objects = await datasetScopes(policy, input.requirements);
    const states = await database.datasetSyncState.findMany({ where: { dataset: policy.dataset } });
    const byScope = new Map(states.map((row) => [row.scope, row]));
    const missing = objects.filter((object) => !byScope.has(object.scope));
    for (let offset = 0; offset < missing.length; offset += 200) {
      await database.datasetSyncState.createMany({
        data: missing.slice(offset, offset + 200).map((object) => ({
          dataset: policy.dataset,
          scope: object.scope,
          policyVersion: policy.version,
          historyStart: object.startDate,
          backfillCursor: object.startDate,
        })),
      });
    }

    objects.sort(
      (left, right) =>
        (byScope.get(left.scope)?.lastCheckedAt?.getTime() ?? 0) -
          (byScope.get(right.scope)?.lastCheckedAt?.getTime() ?? 0) ||
        left.scope.localeCompare(right.scope),
    );
    if (!objects.length) {
      gaps.push(`${policy.dataset}: awaiting reference inventory`);
    }
    inventories.push({
      policy,
      objects,
      states: byScope,
      freshObjects: objects.filter(
        (object) =>
          !object.endDate || object.endDate >= calendarDay(input.targetDate, -policy.revisionDays),
      ),
    });
  }
  return inventories;
}

interface PlanningContext {
  input: PlanInput;
  inventories: Awaited<ReturnType<typeof loadInventories>>;
  selected: PlannedPartition[];
  select(partition: MarketPartition, policy: DatasetPolicy): Promise<boolean>;
  gaps: string[];
  budget: number;
}

async function planFreshPartitions(context: PlanningContext): Promise<void> {
  const { input, inventories, selected, select, gaps, budget } = context;
  const database = getDatabase();
  // 每个数据域先获得机会，再轮转域内对象，历史失败不会独占本轮预算。
  // Give every dataset a turn before rotating its objects, so historical failures cannot monopolize a run.
  for (let objectIndex = 0; selected.length < Math.ceil(budget * 0.4); objectIndex++) {
    let found = false;
    for (const { policy, freshObjects } of inventories) {
      const object = freshObjects[objectIndex];
      if (!object) {
        continue;
      }
      found = true;
      const zone = object.timeZone ?? policy.timeZone;
      const today = localDate(input.startedAt, zone);
      const completed =
        localHour(input.startedAt, zone) >= (object.closeHour ?? policy.closeHour)
          ? today
          : calendarDay(today, -1);
      const end = [
        input.targetDate,
        object.endDate ?? input.targetDate,
        policy.period === 'catalog' ? input.targetDate : completed,
      ].sort()[0];
      if (end < object.startDate) {
        continue;
      }
      const state = await database.datasetSyncState.upsert({
        where: { dataset_scope: { dataset: policy.dataset, scope: object.scope } },
        create: {
          dataset: policy.dataset,
          scope: object.scope,
          policyVersion: policy.version,
          historyStart: object.startDate,
          backfillCursor: object.startDate,
        },
        update: {},
      });
      if (policy.dataset === 'calendar') {
        await select(
          {
            dataset: policy.dataset,
            scope: object.scope,
            startDate: `${[input.targetDate, localDate(input.startedAt)].sort()[0].slice(0, 4)}0101`,
            endDate: calendarDay([input.targetDate, localDate(input.startedAt)].sort()[0], 31),
          },
          policy,
        );
        continue;
      }
      if (policy.period === 'catalog') {
        await select(
          {
            dataset: policy.dataset,
            scope: object.scope,
            startDate: input.targetDate,
            endDate: input.targetDate,
          },
          policy,
        );
        continue;
      }
      let start =
        policy.period === 'day'
          ? end
          : state.plannedThrough
            ? calendarDay(state.plannedThrough, 1)
            : [object.startDate, calendarDay(end, -policy.revisionDays)].sort().at(-1)!;
      if (policy.period === 'quarter') {
        start = state.plannedThrough
          ? start
          : `${Math.max(Number(object.startDate.slice(0, 4)), Number(end.slice(0, 4)) - 2)}0101`;
      }
      if (start > end) {
        start =
          state.recheckCursor &&
          state.recheckCursor <= end &&
          state.recheckCursor >= calendarDay(end, -policy.revisionDays)
            ? state.recheckCursor
            : [object.startDate, calendarDay(end, -policy.revisionDays)].sort().at(-1)!;
      }
      const window = windowAt(start, end, policy.period);
      if (!window) {
        continue;
      }
      if (policy.period === 'day') {
        const recentStart = [object.startDate, calendarDay(end, -policy.revisionDays)]
          .sort()
          .at(-1)!;
        const latest = await database.tradeCal.findFirst({
          where: {
            exchange: object.calendar ?? policy.calendar,
            isOpen: 1,
            calDate: { gte: recentStart, lte: end },
          },
          orderBy: { calDate: 'desc' },
        });
        const { session } = latest
          ? await nextVerifiedSession(
              object.calendar ?? policy.calendar,
              latest.calDate,
              latest.calDate,
            )
          : { session: null };
        if (!session) {
          gaps.push(`${policy.dataset}/${object.scope}: calendar or completed session unavailable`);
          continue;
        }
        window.startDate = session.calDate;
        window.endDate = session.calDate;
      }
      await database.$transaction(async (transaction) => {
        const partition = { dataset: policy.dataset, scope: object.scope, ...window };
        const id = partitionId(partition);
        await transaction.datasetSyncPartition.upsert({
          where: { id },
          create: { id, ...partition, policyVersion: policy.version, status: 'pending' },
          update: {},
        });
        await transaction.datasetSyncState.update({
          where: { dataset_scope: { dataset: policy.dataset, scope: object.scope } },
          data: {
            plannedThrough:
              state.plannedThrough && state.plannedThrough > window.endDate
                ? state.plannedThrough
                : window.endDate,
            // 日分区的近期重查游标由 recent 独占，较粗周期仍在本步骤轮转。
            // Recent owns daily recheck progress; coarser periods rotate within this step.
            ...(policy.period === 'day' ? {} : { recheckCursor: calendarDay(window.endDate, 1) }),
          },
        });
      });
      await select({ dataset: policy.dataset, scope: object.scope, ...window }, policy);
    }
    if (!found) {
      break;
    }
  }
}

async function planRecentPartitions(context: PlanningContext): Promise<void> {
  const { input, inventories, selected, select, budget } = context;
  const database = getDatabase();
  for (const { policy, objects } of inventories.filter((entry) => entry.policy.period === 'day')) {
    for (const object of objects.slice(0, 2)) {
      if (selected.length >= Math.ceil(budget * 0.5)) {
        break;
      }
      const state = await database.datasetSyncState.findUnique({
        where: { dataset_scope: { dataset: policy.dataset, scope: object.scope } },
      });
      if (!state) {
        continue;
      }
      const lower = [object.startDate, calendarDay(input.targetDate, -policy.revisionDays)]
        .sort()
        .at(-1)!;
      let cursor =
        state.recheckCursor &&
        state.recheckCursor >= lower &&
        state.recheckCursor < input.targetDate
          ? state.recheckCursor
          : lower;
      const end = calendarDay(input.targetDate, -1);

      while (cursor <= end && selected.length < Math.ceil(budget * 0.5)) {
        if (input.deadline && Date.now() >= input.deadline) {
          return;
        }
        const { session, through } = await nextVerifiedSession(
          object.calendar ?? policy.calendar,
          cursor,
          end,
        );
        if (!through) {
          break;
        }
        const admitted =
          session &&
          (await select(
            {
              dataset: policy.dataset,
              scope: object.scope,
              startDate: session.calDate,
              endDate: session.calDate,
            },
            policy,
          ));
        cursor = calendarDay(session?.calDate ?? through, 1);
        await database.datasetSyncState.update({
          where: { dataset_scope: { dataset: policy.dataset, scope: object.scope } },
          data: { recheckCursor: cursor },
        });
        if (admitted) {
          break;
        }
      }
    }
  }
}

async function planPendingPartitions(context: PlanningContext): Promise<void> {
  const { input, selected, select, budget } = context;
  const database = getDatabase();
  const pending = await database.datasetSyncPartition.findMany({
    where: {
      endDate: { lte: input.targetDate },
      status: { in: ['pending', 'partial', 'waiting', 'error'] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: input.startedAt } }],
    },
    orderBy: [{ lastAttemptAt: 'asc' }, { startDate: 'asc' }],
  });
  for (const partition of pending) {
    if (selected.length >= Math.ceil(budget * 0.75)) {
      break;
    }
    const policy = DATASET_POLICIES.find((entry) => entry.dataset === partition.dataset);
    if (policy) {
      await select(partition, policy);
    }
  }
}

async function planBackfillPartitions(context: PlanningContext): Promise<void> {
  const { input, inventories, selected, select, gaps, budget } = context;
  const database = getDatabase();
  const backfillInventories = [...inventories].sort((left, right) => {
    const lastServed = (entry: typeof left) =>
      Math.max(
        0,
        ...[...entry.states.values()].map((state) => state.lastBackfillAt?.getTime() ?? 0),
      );

    return lastServed(left) - lastServed(right);
  });
  for (const { policy, objects, states } of backfillInventories) {
    const candidates = [...objects].sort(
      (left, right) =>
        (states.get(left.scope)?.lastBackfillAt?.getTime() ?? 0) -
        (states.get(right.scope)?.lastBackfillAt?.getTime() ?? 0),
    );
    let plannedBackfill = 0;
    for (const object of candidates) {
      if (
        selected.length >= Math.ceil(budget * 0.9) ||
        plannedBackfill >= 2 ||
        policy.period === 'catalog' ||
        (input.deadline && Date.now() >= input.deadline)
      ) {
        break;
      }
      const state = await database.datasetSyncState.findUnique({
        where: { dataset_scope: { dataset: policy.dataset, scope: object.scope } },
      });
      if (!state) {
        continue;
      }
      const zone = object.timeZone ?? policy.timeZone;
      const today = localDate(input.startedAt, zone);
      const completed =
        localHour(input.startedAt, zone) >= (object.closeHour ?? policy.closeHour)
          ? today
          : calendarDay(today, -1);
      const end = [input.targetDate, object.endDate ?? input.targetDate, completed].sort()[0];
      const window = windowAt(state.backfillCursor, end, policy.period);
      if (!window) {
        continue;
      }
      if (policy.period === 'day') {
        const { session, through } = await nextVerifiedSession(
          object.calendar ?? policy.calendar,
          state.backfillCursor,
          end,
        );
        if (!session && through) {
          await database.datasetSyncState.update({
            where: { dataset_scope: { dataset: policy.dataset, scope: object.scope } },
            data: { backfillCursor: calendarDay(through, 1), lastBackfillAt: input.startedAt },
          });
        }
        if (!through) {
          gaps.push(
            `${policy.dataset}/${object.scope}: backfill awaits calendar at ${state.backfillCursor}`,
          );
        }
        if (!session) {
          continue;
        }
        window.startDate = session.calDate;
        window.endDate = session.calDate;
      }
      if (await select({ dataset: policy.dataset, scope: object.scope, ...window }, policy)) {
        plannedBackfill++;
        await database.datasetSyncState.update({
          where: { dataset_scope: { dataset: policy.dataset, scope: object.scope } },
          data: { backfillCursor: calendarDay(window.endDate, 1), lastBackfillAt: input.startedAt },
        });
      }
    }
  }
}

async function planDuePartitions(context: PlanningContext): Promise<void> {
  const { input, select, budget } = context;
  const database = getDatabase();
  const due = await database.datasetSyncPartition.findMany({
    where: {
      endDate: { lte: input.targetDate },
      status: { in: ['complete', 'not_applicable'] },
      nextAttemptAt: { lte: input.startedAt },
    },
    orderBy: [{ checkedAt: 'asc' }, { startDate: 'asc' }],
    take: budget,
  });
  for (const partition of due) {
    const policy = DATASET_POLICIES.find((entry) => entry.dataset === partition.dataset);
    if (policy) {
      await select(partition, policy);
    }
  }
}
