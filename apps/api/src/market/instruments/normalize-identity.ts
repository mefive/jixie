import type { MarketTransaction } from '../synchronization/partition.js';
import { emptyWriteResult, fingerprint, sameValues } from '../synchronization/rows.js';
import { STOCK_CODE_CHANGES, type StockCodeChangeDefinition } from './stock-identity.js';

/** 已确认身份接续先核对全部冲突，再修改原值。 / Check every confirmed lineage before changing rows. */
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
  {
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
      for (const row of planned.move) {
        await transaction.daily.update({
          where: { tsCode_tradeDate: { tsCode: row.tsCode, tradeDate: row.tradeDate } },
          data: { tsCode: change.newTsCode },
        });
        result.updated++;
      }
    });
  }
  {
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
      for (const row of planned.move) {
        await transaction.adjFactor.update({
          where: { tsCode_tradeDate: { tsCode: row.tsCode, tradeDate: row.tradeDate } },
          data: { tsCode: change.newTsCode },
        });
        result.updated++;
      }
    });
  }
  {
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
      for (const row of planned.move) {
        await transaction.dailyBasic.update({
          where: { tsCode_tradeDate: { tsCode: row.tsCode, tradeDate: row.tradeDate } },
          data: { tsCode: change.newTsCode },
        });
        result.updated++;
      }
    });
  }
  {
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
      for (const row of planned.move) {
        await transaction.stkLimit.update({
          where: { tsCode_tradeDate: { tsCode: row.tsCode, tradeDate: row.tradeDate } },
          data: { tsCode: change.newTsCode },
        });
        result.updated++;
      }
    });
  }
  {
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
      for (const row of planned.move) {
        await transaction.stockNameHistory.update({
          where: { tsCode_startDate: { tsCode: row.tsCode, startDate: row.startDate } },
          data: { tsCode: change.newTsCode },
        });
        result.updated++;
      }
    });
  }
  {
    const rows = await transaction.finaIndicator.findMany({
      where: { tsCode: { in: [change.oldTsCode, change.newTsCode] } },
    });
    const planned = planLineage(
      rows,
      (row) => row.tsCode,
      (row) => JSON.stringify([row.tsCode, row.endDate]),
      (row) => ({ ...row, tsCode: change.newTsCode }),
      change,
    );
    actions.push(async () => {
      for (const row of planned.remove) {
        await transaction.finaIndicator.delete({
          where: { tsCode_endDate: { tsCode: row.tsCode, endDate: row.endDate } },
        });
        result.deleted++;
      }
      for (const row of planned.move) {
        await transaction.finaIndicator.update({
          where: { tsCode_endDate: { tsCode: row.tsCode, endDate: row.endDate } },
          data: { tsCode: change.newTsCode },
        });
        result.updated++;
      }
    });
  }
  {
    const rows = await transaction.finaIndicatorVersion.findMany({
      where: { tsCode: { in: [change.oldTsCode, change.newTsCode] } },
    });
    const planned = planLineage(
      rows,
      (row) => row.tsCode,
      (row) => JSON.stringify([row.sourceFingerprint]),
      (row) => ({ ...row, tsCode: change.newTsCode }),
      change,
    );
    actions.push(async () => {
      for (const row of planned.remove) {
        await transaction.finaIndicatorVersion.delete({
          where: { sourceFingerprint: row.sourceFingerprint },
        });
        result.deleted++;
      }
      for (const row of planned.move) {
        await transaction.finaIndicatorVersion.update({
          where: { sourceFingerprint: row.sourceFingerprint },
          data: { tsCode: change.newTsCode },
        });
        result.updated++;
      }
    });
  }
  {
    const rows = await transaction.financialIncomeStatement.findMany({
      where: { tsCode: { in: [change.oldTsCode, change.newTsCode] } },
    });
    const planned = planLineage(
      rows,
      (row) => row.tsCode,
      (row) => JSON.stringify([row.sourceRowFingerprint]),
      (row) => ({ ...row, tsCode: change.newTsCode }),
      change,
    );
    actions.push(async () => {
      for (const row of planned.remove) {
        await transaction.financialIncomeStatement.delete({
          where: { sourceRowFingerprint: row.sourceRowFingerprint },
        });
        result.deleted++;
      }
      for (const row of planned.move) {
        await transaction.financialIncomeStatement.update({
          where: { sourceRowFingerprint: row.sourceRowFingerprint },
          data: { tsCode: change.newTsCode },
        });
        result.updated++;
      }
    });
  }
  {
    const rows = await transaction.financialBalanceSheet.findMany({
      where: { tsCode: { in: [change.oldTsCode, change.newTsCode] } },
    });
    const planned = planLineage(
      rows,
      (row) => row.tsCode,
      (row) => JSON.stringify([row.sourceRowFingerprint]),
      (row) => ({ ...row, tsCode: change.newTsCode }),
      change,
    );
    actions.push(async () => {
      for (const row of planned.remove) {
        await transaction.financialBalanceSheet.delete({
          where: { sourceRowFingerprint: row.sourceRowFingerprint },
        });
        result.deleted++;
      }
      for (const row of planned.move) {
        await transaction.financialBalanceSheet.update({
          where: { sourceRowFingerprint: row.sourceRowFingerprint },
          data: { tsCode: change.newTsCode },
        });
        result.updated++;
      }
    });
  }
  {
    const rows = await transaction.financialCashFlowStatement.findMany({
      where: { tsCode: { in: [change.oldTsCode, change.newTsCode] } },
    });
    const planned = planLineage(
      rows,
      (row) => row.tsCode,
      (row) => JSON.stringify([row.sourceRowFingerprint]),
      (row) => ({ ...row, tsCode: change.newTsCode }),
      change,
    );
    actions.push(async () => {
      for (const row of planned.remove) {
        await transaction.financialCashFlowStatement.delete({
          where: { sourceRowFingerprint: row.sourceRowFingerprint },
        });
        result.deleted++;
      }
      for (const row of planned.move) {
        await transaction.financialCashFlowStatement.update({
          where: { sourceRowFingerprint: row.sourceRowFingerprint },
          data: { tsCode: change.newTsCode },
        });
        result.updated++;
      }
    });
  }
  {
    const rows = await transaction.dividend.findMany({
      where: { tsCode: { in: [change.oldTsCode, change.newTsCode] } },
    });
    const planned = planLineage(
      rows,
      (row) => row.tsCode,
      (row) => JSON.stringify([row.id]),
      (row) => ({
        ...row,
        tsCode: change.newTsCode,
        id: fingerprint({
          tsCode: change.newTsCode,
          endDate: row.endDate,
          annDate: row.annDate,
          exDate: row.exDate,
          divProc: row.divProc,
        }),
      }),
      change,
    );
    actions.push(async () => {
      for (const row of planned.remove) {
        await transaction.dividend.delete({ where: { id: row.id } });
        result.deleted++;
      }
      for (const row of planned.move) {
        const replacement = {
          ...row,
          tsCode: change.newTsCode,
          id: fingerprint({
            tsCode: change.newTsCode,
            endDate: row.endDate,
            annDate: row.annDate,
            exDate: row.exDate,
            divProc: row.divProc,
          }),
        };
        await transaction.dividend.delete({ where: { id: row.id } });
        await transaction.dividend.create({ data: replacement });
        result.updated++;
      }
    });
  }
  {
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
      for (const row of planned.move) {
        await transaction.indexWeight.update({
          where: {
            indexCode_conCode_tradeDate: {
              indexCode: row.indexCode,
              conCode: row.conCode,
              tradeDate: row.tradeDate,
            },
          },
          data: { conCode: change.newTsCode },
        });
        result.updated++;
      }
    });
  }
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

/** 只做内存冲突比较，数据库读写保留显式类型。 / Compare conflicts in memory; keep database access explicitly typed. */
function planLineage<Row extends object>(
  rows: Row[],
  code: (row: Row) => string,
  key: (row: Row) => string,
  transform: (row: Row) => Row,
  change: StockCodeChangeDefinition,
) {
  const current = new Map(
    rows.filter((row) => code(row) === change.newTsCode).map((row) => [key(row), row]),
  );
  const move: Row[] = [];
  const remove: Row[] = [];
  for (const row of rows.filter((value) => code(value) === change.oldTsCode)) {
    const proposed = transform(row);
    const duplicate = current.get(key(proposed));
    if (
      duplicate &&
      !sameValues(duplicate, proposed, ['id', 'retrievedAt', 'observedAt', 'availabilityQuality'])
    ) {
      throw new Error(
        `Security identity conflict ${key(proposed)}: ${change.oldTsCode} -> ${change.newTsCode}`,
      );
    }
    if (duplicate) {
      remove.push(row);
    } else {
      current.set(key(proposed), proposed);
      move.push(row);
    }
  }

  return { move, remove };
}
