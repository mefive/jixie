import { preferStockSources } from './source-selection.js';
import type { MarketTransaction } from '../synchronization/partition.js';
import { mergeIndicatorSnapshot } from '../fundamentals/indicator-selection.js';
import { emptyWriteResult, fingerprint, sameValues } from '../synchronization/rows.js';
import {
  STOCK_CODE_CHANGES,
  stockSourceRank,
  type StockCodeChangeDefinition,
} from './stock-identity.js';

/**
 * 已确认身份接续先核对全部冲突，再修改原值。
 *
 * Check every confirmed lineage before changing rows.
 */
export async function normalizeStockIdentity(
  transaction: MarketTransaction,
  change: StockCodeChangeDefinition,
) {
  if (
    !STOCK_CODE_CHANGES.some(
      (known) =>
        known.oldTsCode === change.oldTsCode &&
        known.newTsCode === change.newTsCode &&
        known.effectiveDate === change.effectiveDate,
    )
  ) {
    throw new Error('Unconfirmed security succession');
  }
  const result = emptyWriteResult();
  const actions: Array<() => Promise<void>> = [];
  await normalizeDaily(transaction, change, actions, result);
  await normalizeAdjFactor(transaction, change, actions, result);
  await normalizeDailyBasic(transaction, change, actions, result);
  await normalizeStkLimit(transaction, change, actions, result);
  await normalizeStockNameHistory(transaction, change, actions, result);
  await normalizeFinaIndicator(transaction, change, actions, result);
  normalizeVersions(transaction, change, actions, result);
  await normalizeDividend(transaction, change, actions, result);
  await normalizeIndexWeight(transaction, change, actions, result);

  const previous = await transaction.stockCodeChange.findUnique({
    where: { oldTsCode: change.oldTsCode },
  });
  for (const action of actions) {
    await action();
  }
  if (!previous || !sameValues(previous, change)) {
    await transaction.stockCodeChange.upsert({
      where: { oldTsCode: change.oldTsCode },
      create: change,
      update: change,
    });
    result.updated++;
  }
  result.changed = result.updated + result.deleted > 0;

  return result;
}

/**
 * 指纹已全局唯一；版本只移动证券身份，不合并或删除来源证据。
 *
 * Globally unique fingerprints let versions move identity without merging or deleting evidence.
 */
function normalizeVersions(
  transaction: MarketTransaction,
  change: StockCodeChangeDefinition,
  actions: Array<() => Promise<void>>,
  result: ReturnType<typeof emptyWriteResult>,
) {
  const input = { where: { tsCode: change.oldTsCode }, data: { tsCode: change.newTsCode } };
  actions.push(async () => {
    const indicators = await transaction.finaIndicatorVersion.updateMany(input);
    const income = await transaction.financialIncomeStatement.updateMany(input);
    const balance = await transaction.financialBalanceSheet.updateMany(input);
    const cashFlow = await transaction.financialCashFlowStatement.updateMany(input);
    result.updated += indicators.count + income.count + balance.count + cashFlow.count;
  });
}

async function normalizeDaily(
  transaction: MarketTransaction,
  change: StockCodeChangeDefinition,
  actions: Array<() => Promise<void>>,
  result: ReturnType<typeof emptyWriteResult>,
) {
  const rows = await transaction.daily.findMany({
    where: { tsCode: { in: [change.oldTsCode, change.newTsCode] } },
  });
  const planned = planLineage(
    rows,
    (row) => row.tsCode,
    (row) => JSON.stringify([row.tsCode, row.tradeDate]),
    (row) => ({ ...row, tsCode: change.newTsCode }),
    change,
  );
  actions.push(async () => {
    for (const row of planned.remove) {
      await transaction.daily.delete({
        where: { tsCode_tradeDate: { tsCode: row.tsCode, tradeDate: row.tradeDate } },
      });
      result.deleted++;
    }
    for (const { before: row, after } of planned.move) {
      await transaction.daily.update({
        where: { tsCode_tradeDate: { tsCode: row.tsCode, tradeDate: row.tradeDate } },
        data: after,
      });
      result.updated++;
    }
  });
}

async function normalizeAdjFactor(
  transaction: MarketTransaction,
  change: StockCodeChangeDefinition,
  actions: Array<() => Promise<void>>,
  result: ReturnType<typeof emptyWriteResult>,
) {
  const rows = await transaction.adjFactor.findMany({
    where: { tsCode: { in: [change.oldTsCode, change.newTsCode] } },
  });
  const planned = planLineage(
    rows,
    (row) => row.tsCode,
    (row) => JSON.stringify([row.tsCode, row.tradeDate]),
    (row) => ({ ...row, tsCode: change.newTsCode }),
    change,
  );
  actions.push(async () => {
    for (const row of planned.remove) {
      await transaction.adjFactor.delete({
        where: { tsCode_tradeDate: { tsCode: row.tsCode, tradeDate: row.tradeDate } },
      });
      result.deleted++;
    }
    for (const { before: row, after } of planned.move) {
      await transaction.adjFactor.update({
        where: { tsCode_tradeDate: { tsCode: row.tsCode, tradeDate: row.tradeDate } },
        data: after,
      });
      result.updated++;
    }
  });
}

async function normalizeDailyBasic(
  transaction: MarketTransaction,
  change: StockCodeChangeDefinition,
  actions: Array<() => Promise<void>>,
  result: ReturnType<typeof emptyWriteResult>,
) {
  const rows = await transaction.dailyBasic.findMany({
    where: { tsCode: { in: [change.oldTsCode, change.newTsCode] } },
  });
  const planned = planLineage(
    rows,
    (row) => row.tsCode,
    (row) => JSON.stringify([row.tsCode, row.tradeDate]),
    (row) => ({ ...row, tsCode: change.newTsCode }),
    change,
  );
  actions.push(async () => {
    for (const row of planned.remove) {
      await transaction.dailyBasic.delete({
        where: { tsCode_tradeDate: { tsCode: row.tsCode, tradeDate: row.tradeDate } },
      });
      result.deleted++;
    }
    for (const { before: row, after } of planned.move) {
      await transaction.dailyBasic.update({
        where: { tsCode_tradeDate: { tsCode: row.tsCode, tradeDate: row.tradeDate } },
        data: after,
      });
      result.updated++;
    }
  });
}

async function normalizeStkLimit(
  transaction: MarketTransaction,
  change: StockCodeChangeDefinition,
  actions: Array<() => Promise<void>>,
  result: ReturnType<typeof emptyWriteResult>,
) {
  const rows = await transaction.stkLimit.findMany({
    where: { tsCode: { in: [change.oldTsCode, change.newTsCode] } },
  });
  const planned = planLineage(
    rows,
    (row) => row.tsCode,
    (row) => JSON.stringify([row.tsCode, row.tradeDate]),
    (row) => ({ ...row, tsCode: change.newTsCode }),
    change,
  );
  actions.push(async () => {
    for (const row of planned.remove) {
      await transaction.stkLimit.delete({
        where: { tsCode_tradeDate: { tsCode: row.tsCode, tradeDate: row.tradeDate } },
      });
      result.deleted++;
    }
    for (const { before: row, after } of planned.move) {
      await transaction.stkLimit.update({
        where: { tsCode_tradeDate: { tsCode: row.tsCode, tradeDate: row.tradeDate } },
        data: after,
      });
      result.updated++;
    }
  });
}

async function normalizeStockNameHistory(
  transaction: MarketTransaction,
  change: StockCodeChangeDefinition,
  actions: Array<() => Promise<void>>,
  result: ReturnType<typeof emptyWriteResult>,
) {
  const rows = await transaction.stockNameHistory.findMany({
    where: { tsCode: { in: [change.oldTsCode, change.newTsCode] } },
  });
  const planned = planLineage(
    rows,
    (row) => row.tsCode,
    (row) => JSON.stringify([row.tsCode, row.startDate]),
    (row) => ({ ...row, tsCode: change.newTsCode }),
    change,
  );
  actions.push(async () => {
    for (const row of planned.remove) {
      await transaction.stockNameHistory.delete({
        where: { tsCode_startDate: { tsCode: row.tsCode, startDate: row.startDate } },
      });
      result.deleted++;
    }
    for (const { before: row, after } of planned.move) {
      await transaction.stockNameHistory.update({
        where: { tsCode_startDate: { tsCode: row.tsCode, startDate: row.startDate } },
        data: after,
      });
      result.updated++;
    }
  });
}

async function normalizeFinaIndicator(
  transaction: MarketTransaction,
  change: StockCodeChangeDefinition,
  actions: Array<() => Promise<void>>,
  result: ReturnType<typeof emptyWriteResult>,
) {
  const rows = await transaction.finaIndicator.findMany({
    where: { tsCode: { in: [change.oldTsCode, change.newTsCode] } },
  });
  const planned = planLineage(
    rows,
    (row) => row.tsCode,
    (row) => JSON.stringify([row.tsCode, row.endDate]),
    (row) => ({ ...row, tsCode: change.newTsCode }),
    change,
    (previous, incoming) => ({
      ...previous,
      ...mergeIndicatorSnapshot(previous, { values: incoming }),
    }),
  );
  actions.push(async () => {
    for (const row of planned.remove) {
      await transaction.finaIndicator.delete({
        where: { tsCode_endDate: { tsCode: row.tsCode, endDate: row.endDate } },
      });
      result.deleted++;
    }
    for (const { before: row, after } of planned.move) {
      await transaction.finaIndicator.update({
        where: { tsCode_endDate: { tsCode: row.tsCode, endDate: row.endDate } },
        data: after,
      });
      result.updated++;
    }
  });
}

async function normalizeDividend(
  transaction: MarketTransaction,
  change: StockCodeChangeDefinition,
  actions: Array<() => Promise<void>>,
  result: ReturnType<typeof emptyWriteResult>,
) {
  const rows = await transaction.dividend.findMany({
    where: { tsCode: { in: [change.oldTsCode, change.newTsCode] } },
  });
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const id = fingerprint({
      tsCode: change.newTsCode,
      endDate: row.endDate,
      annDate: row.annDate,
      exDate: row.exDate,
      divProc: row.divProc,
    });
    groups.set(id, [...(groups.get(id) ?? []), row]);
  }

  for (const [id, candidates] of groups) {
    const preferred = preferStockSources(
      candidates,
      () => id,
      (row) => row.sourceTsCode ?? row.tsCode,
    );
    preferred.sort((left, right) => {
      const leftCanonical = left.id === id ? 0 : 1;
      const rightCanonical = right.id === id ? 0 : 1;

      return leftCanonical - rightCanonical || left.id.localeCompare(right.id);
    });
    const selected = preferred[0];
    const ignored = ['id', 'tsCode', 'observedAt', 'availabilityQuality', 'sourceTsCode'];
    if (preferred.some((row) => !sameValues(selected, row, ignored))) {
      throw new Error(`Conflicting same-source dividend event ${id}`);
    }
    if (candidates.length === 1 && selected.id === id && selected.tsCode === change.newTsCode) {
      continue;
    }

    actions.push(async () => {
      await transaction.dividend.deleteMany({
        where: { id: { in: candidates.map((row) => row.id) } },
      });
      await transaction.dividend.create({ data: { ...selected, id, tsCode: change.newTsCode } });
      result.deleted += candidates.length - 1;
      result.updated++;
    });
  }
}

async function normalizeIndexWeight(
  transaction: MarketTransaction,
  change: StockCodeChangeDefinition,
  actions: Array<() => Promise<void>>,
  result: ReturnType<typeof emptyWriteResult>,
) {
  const rows = await transaction.indexWeight.findMany({
    where: { conCode: { in: [change.oldTsCode, change.newTsCode] } },
  });
  const planned = planLineage(
    rows,
    (row) => row.conCode,
    (row) => JSON.stringify([row.indexCode, row.conCode, row.tradeDate]),
    (row) => ({ ...row, conCode: change.newTsCode }),
    change,
  );
  actions.push(async () => {
    for (const row of planned.remove) {
      await transaction.indexWeight.delete({
        where: {
          indexCode_conCode_tradeDate: {
            indexCode: row.indexCode,
            conCode: row.conCode,
            tradeDate: row.tradeDate,
          },
        },
      });
      result.deleted++;
    }
    for (const { before: row, after } of planned.move) {
      await transaction.indexWeight.update({
        where: {
          indexCode_conCode_tradeDate: {
            indexCode: row.indexCode,
            conCode: row.conCode,
            tradeDate: row.tradeDate,
          },
        },
        data: after,
      });
      result.updated++;
    }
  });
}

/**
 * 同键快照优先新来源；历史来源未知时仅按原存储身份选行，不伪造来源字段。
 *
 * Prefer newer sources for colliding snapshots. Unknown origins use stored identity only
 * for selection, without inventing provenance. Equal-source revisions use the domain policy.
 */
function planLineage<Row extends { sourceTsCode: string | null }>(
  rows: Row[],
  code: (row: Row) => string,
  key: (row: Row) => string,
  transform: (row: Row) => Row,
  change: StockCodeChangeDefinition,
  resolve?: (previous: Row, incoming: Row) => Row,
) {
  const current = new Map(
    rows.filter((row) => code(row) === change.newTsCode).map((row) => [key(row), row]),
  );
  const move: Array<{ before: Row; after: Row }> = [];
  const remove: Row[] = [];
  for (const row of rows.filter((value) => code(value) === change.oldTsCode)) {
    const proposed = transform(row);
    const duplicate = current.get(key(proposed));
    if (!duplicate) {
      current.set(key(proposed), proposed);
      move.push({ before: row, after: proposed });
      continue;
    }

    const rank = stockSourceRank(row.sourceTsCode ?? code(row));
    const previousRank = stockSourceRank(duplicate.sourceTsCode ?? code(duplicate));
    const ignored = ['id', 'observedAt', 'availabilityQuality', 'sourceTsCode'];
    const resolved = rank === previousRank && resolve ? resolve(duplicate, proposed) : proposed;
    if (rank === previousRank && !resolve && !sameValues(duplicate, proposed, ignored)) {
      throw new Error(`Conflicting same-source stock identity ${key(proposed)}`);
    }
    if (rank > previousRank || (rank === previousRank && !sameValues(duplicate, resolved))) {
      move.push({ before: duplicate, after: resolved });
      current.set(key(proposed), resolved);
    }
    remove.push(row);
  }

  return { move, remove };
}
