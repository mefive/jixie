import { ulid } from 'ulid';
import { prisma } from '../lib/prisma.js';
import { STOCK_CODE_CHANGES } from '../market/stock-identity.js';
import { seedStockCodeChanges } from '../store/sync.js';

type PlainRow = Record<string, unknown>;

const CANONICALIZATION_TRANSACTION_TIMEOUT_MS = 120_000;

export interface StockCodeCanonicalizationSummary {
  migrated: number;
  earliestMarketDate: string | null;
}

interface MergeRowsOptions<Row extends PlainRow> {
  table: string;
  oldCode: string;
  newCode: string;
  oldRows: Row[];
  newRows: Row[];
  keyOf: (row: Row) => string;
  comparable: (row: Row) => PlainRow;
  equivalent?: (oldRow: Row, newRow: Row) => boolean;
  rewrite: (row: Row, newCode: string) => Row;
  create: (rows: Row[]) => Promise<unknown>;
  deleteOld: () => Promise<unknown>;
}

function stableRow(row: PlainRow): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(row)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, value]),
    ),
  );
}

async function mergeRows<Row extends PlainRow>(options: MergeRowsOptions<Row>): Promise<number> {
  const newByKey = new Map(options.newRows.map((row) => [options.keyOf(row), row]));
  const rowsToCreate: Row[] = [];

  for (const oldRow of options.oldRows) {
    const key = options.keyOf(oldRow);
    const newRow = newByKey.get(key);
    if (!newRow) {
      rowsToCreate.push(options.rewrite(oldRow, options.newCode));
      continue;
    }
    const equivalent = options.equivalent
      ? options.equivalent(oldRow, newRow)
      : stableRow(options.comparable(oldRow)) === stableRow(options.comparable(newRow));
    if (!equivalent) {
      throw new Error(
        `${options.table} conflict for ${options.oldCode} → ${options.newCode}, key ${key}: ` +
          `${stableRow(options.comparable(oldRow))} != ${stableRow(options.comparable(newRow))}`,
      );
    }
  }

  if (rowsToCreate.length > 0) {
    await options.create(rowsToCreate);
  }
  await options.deleteOld();
  return rowsToCreate.length;
}

function withoutCode(row: PlainRow, codeField: 'tsCode' | 'conCode', ignored: string[] = []) {
  const excluded = new Set<string>([codeField, ...ignored]);
  return Object.fromEntries(Object.entries(row).filter(([key]) => !excluded.has(key)));
}

function equivalentDividendYield(oldValue: unknown, newValue: unknown): boolean {
  if (oldValue === newValue) {
    return true;
  }
  if (oldValue === null && typeof newValue === 'number') {
    return true;
  }
  return (
    typeof oldValue === 'number' &&
    typeof newValue === 'number' &&
    Math.abs(oldValue - newValue) <= 0.005_001
  );
}

function equivalentDailyBasic(oldRow: PlainRow, newRow: PlainRow): boolean {
  const { dvRatio: oldDvRatio, dvTtm: oldDvTtm, ...oldComparable } = withoutCode(oldRow, 'tsCode');
  const { dvRatio: newDvRatio, dvTtm: newDvTtm, ...newComparable } = withoutCode(newRow, 'tsCode');
  return (
    stableRow(oldComparable) === stableRow(newComparable) &&
    equivalentDividendYield(oldDvRatio, newDvRatio) &&
    equivalentDividendYield(oldDvTtm, newDvTtm)
  );
}

export async function canonicalizeStockCodes(): Promise<StockCodeCanonicalizationSummary> {
  await seedStockCodeChanges();
  let totalMigrated = 0;
  let earliestMarketDate: string | null = null;

  for (const change of STOCK_CODE_CHANGES) {
    const { oldTsCode, newTsCode } = change;
    const affectedDate = await earliestMarketInputDate(oldTsCode);
    if (affectedDate && (!earliestMarketDate || affectedDate < earliestMarketDate)) {
      earliestMarketDate = affectedDate;
    }
    const migrated = await prisma.$transaction(
      async (transaction) => {
        let count = 0;
        const dailyOld = await transaction.daily.findMany({ where: { tsCode: oldTsCode } });
        const dailyNew = await transaction.daily.findMany({ where: { tsCode: newTsCode } });
        count += await mergeRows({
          table: 'Daily',
          oldCode: oldTsCode,
          newCode: newTsCode,
          oldRows: dailyOld,
          newRows: dailyNew,
          keyOf: (row) => String(row.tradeDate),
          comparable: (row) => withoutCode(row, 'tsCode'),
          rewrite: (row, code) => ({ ...row, tsCode: code }),
          create: (rows) => transaction.daily.createMany({ data: rows }),
          deleteOld: () => transaction.daily.deleteMany({ where: { tsCode: oldTsCode } }),
        });

        const adjOld = await transaction.adjFactor.findMany({ where: { tsCode: oldTsCode } });
        const adjNew = await transaction.adjFactor.findMany({ where: { tsCode: newTsCode } });
        count += await mergeRows({
          table: 'AdjFactor',
          oldCode: oldTsCode,
          newCode: newTsCode,
          oldRows: adjOld,
          newRows: adjNew,
          keyOf: (row) => String(row.tradeDate),
          comparable: (row) => withoutCode(row, 'tsCode'),
          // Tushare may revise a historical adjustment factor by the fourth decimal after a code
          // succession. The canonical-code series wins; only a relative difference above 0.1% blocks.
          equivalent: (oldRow, newRow) =>
            Math.abs(oldRow.adjFactor - newRow.adjFactor) /
              Math.max(Math.abs(oldRow.adjFactor), Math.abs(newRow.adjFactor), 1) <=
            0.001,
          rewrite: (row, code) => ({ ...row, tsCode: code }),
          create: (rows) => transaction.adjFactor.createMany({ data: rows }),
          deleteOld: () => transaction.adjFactor.deleteMany({ where: { tsCode: oldTsCode } }),
        });

        const basicOld = await transaction.dailyBasic.findMany({ where: { tsCode: oldTsCode } });
        const basicNew = await transaction.dailyBasic.findMany({ where: { tsCode: newTsCode } });
        count += await mergeRows({
          table: 'DailyBasic',
          oldCode: oldTsCode,
          newCode: newTsCode,
          oldRows: basicOld,
          newRows: basicNew,
          keyOf: (row) => String(row.tradeDate),
          comparable: (row) => withoutCode(row, 'tsCode'),
          // The canonical-code snapshot may backfill dividend yield or retain one more decimal.
          // All non-dividend fields still need to match exactly.
          equivalent: equivalentDailyBasic,
          rewrite: (row, code) => ({ ...row, tsCode: code }),
          create: (rows) => transaction.dailyBasic.createMany({ data: rows }),
          deleteOld: () => transaction.dailyBasic.deleteMany({ where: { tsCode: oldTsCode } }),
        });

        const limitOld = await transaction.stkLimit.findMany({ where: { tsCode: oldTsCode } });
        const limitNew = await transaction.stkLimit.findMany({ where: { tsCode: newTsCode } });
        count += await mergeRows({
          table: 'StkLimit',
          oldCode: oldTsCode,
          newCode: newTsCode,
          oldRows: limitOld,
          newRows: limitNew,
          keyOf: (row) => String(row.tradeDate),
          comparable: (row) => withoutCode(row, 'tsCode'),
          rewrite: (row, code) => ({ ...row, tsCode: code }),
          create: (rows) => transaction.stkLimit.createMany({ data: rows }),
          deleteOld: () => transaction.stkLimit.deleteMany({ where: { tsCode: oldTsCode } }),
        });

        const moneyflowOld = await transaction.moneyflow.findMany({ where: { tsCode: oldTsCode } });
        const moneyflowNew = await transaction.moneyflow.findMany({ where: { tsCode: newTsCode } });
        count += await mergeRows({
          table: 'Moneyflow',
          oldCode: oldTsCode,
          newCode: newTsCode,
          oldRows: moneyflowOld,
          newRows: moneyflowNew,
          keyOf: (row) => String(row.tradeDate),
          comparable: (row) => withoutCode(row, 'tsCode'),
          rewrite: (row, code) => ({ ...row, tsCode: code }),
          create: (rows) => transaction.moneyflow.createMany({ data: rows }),
          deleteOld: () => transaction.moneyflow.deleteMany({ where: { tsCode: oldTsCode } }),
        });

        const topListOld = await transaction.topList.findMany({ where: { tsCode: oldTsCode } });
        const topListNew = await transaction.topList.findMany({ where: { tsCode: newTsCode } });
        count += await mergeRows({
          table: 'TopList',
          oldCode: oldTsCode,
          newCode: newTsCode,
          oldRows: topListOld,
          newRows: topListNew,
          keyOf: (row) => String(row.tradeDate),
          comparable: (row) => withoutCode(row, 'tsCode'),
          rewrite: (row, code) => ({ ...row, tsCode: code }),
          create: (rows) => transaction.topList.createMany({ data: rows }),
          deleteOld: () => transaction.topList.deleteMany({ where: { tsCode: oldTsCode } }),
        });

        const finaOld = await transaction.finaIndicator.findMany({ where: { tsCode: oldTsCode } });
        const finaNew = await transaction.finaIndicator.findMany({ where: { tsCode: newTsCode } });
        count += await mergeRows({
          table: 'FinaIndicator',
          oldCode: oldTsCode,
          newCode: newTsCode,
          oldRows: finaOld,
          newRows: finaNew,
          keyOf: (row) => String(row.endDate),
          comparable: (row) => withoutCode(row, 'tsCode'),
          // Financial indicators can be restated after a merger/code succession. For the same
          // reporting period, the canonical-code row is the provider's latest surviving version.
          equivalent: () => true,
          rewrite: (row, code) => ({ ...row, tsCode: code }),
          create: (rows) => transaction.finaIndicator.createMany({ data: rows }),
          deleteOld: () => transaction.finaIndicator.deleteMany({ where: { tsCode: oldTsCode } }),
        });

        const incomeVersions = await transaction.financialIncomeStatement.updateMany({
          where: { tsCode: oldTsCode },
          data: { tsCode: newTsCode },
        });
        const balanceVersions = await transaction.financialBalanceSheet.updateMany({
          where: { tsCode: oldTsCode },
          data: { tsCode: newTsCode },
        });
        const cashFlowVersions = await transaction.financialCashFlowStatement.updateMany({
          where: { tsCode: oldTsCode },
          data: { tsCode: newTsCode },
        });
        const correctionEvidence = await transaction.financialCorrectionEvidence.updateMany({
          where: { tsCode: oldTsCode },
          data: { tsCode: newTsCode },
        });
        count +=
          incomeVersions.count +
          balanceVersions.count +
          cashFlowVersions.count +
          correctionEvidence.count;

        const dividendOld = await transaction.dividend.findMany({ where: { tsCode: oldTsCode } });
        const dividendNew = await transaction.dividend.findMany({ where: { tsCode: newTsCode } });
        count += await mergeRows({
          table: 'Dividend',
          oldCode: oldTsCode,
          newCode: newTsCode,
          oldRows: dividendOld,
          newRows: dividendNew,
          keyOf: (row) => stableRow(withoutCode(row, 'tsCode', ['id'])),
          comparable: (row) => withoutCode(row, 'tsCode', ['id']),
          rewrite: (row, code) => ({ ...row, id: ulid(), tsCode: code }),
          create: (rows) => transaction.dividend.createMany({ data: rows }),
          deleteOld: () => transaction.dividend.deleteMany({ where: { tsCode: oldTsCode } }),
        });

        const industryOld = await transaction.swIndustryMember.findMany({
          where: { tsCode: oldTsCode },
        });
        const industryNew = await transaction.swIndustryMember.findMany({
          where: { tsCode: newTsCode },
        });
        count += await mergeRows({
          table: 'SwIndustryMember',
          oldCode: oldTsCode,
          newCode: newTsCode,
          oldRows: industryOld,
          newRows: industryNew,
          keyOf: (row) => `${row.l1Code}|${row.inDate}`,
          comparable: (row) => withoutCode(row, 'tsCode'),
          rewrite: (row, code) => ({ ...row, tsCode: code }),
          create: (rows) => transaction.swIndustryMember.createMany({ data: rows }),
          deleteOld: () =>
            transaction.swIndustryMember.deleteMany({ where: { tsCode: oldTsCode } }),
        });

        const weightOld = await transaction.indexWeight.findMany({ where: { conCode: oldTsCode } });
        const weightNew = await transaction.indexWeight.findMany({ where: { conCode: newTsCode } });
        count += await mergeRows({
          table: 'IndexWeight',
          oldCode: oldTsCode,
          newCode: newTsCode,
          oldRows: weightOld,
          newRows: weightNew,
          keyOf: (row) => `${row.indexCode}|${row.tradeDate}`,
          comparable: (row) => withoutCode(row, 'conCode'),
          rewrite: (row, code) => ({ ...row, conCode: code }),
          create: (rows) => transaction.indexWeight.createMany({ data: rows }),
          deleteOld: () => transaction.indexWeight.deleteMany({ where: { conCode: oldTsCode } }),
        });

        return count;
      },
      { timeout: CANONICALIZATION_TRANSACTION_TIMEOUT_MS },
    );

    console.log(`${oldTsCode} → ${newTsCode}: migrated ${migrated} old-only rows`);
    totalMigrated += migrated;
  }

  console.log('Stock-code canonicalization complete');
  return { migrated: totalMigrated, earliestMarketDate };
}

async function earliestMarketInputDate(oldTsCode: string): Promise<string | null> {
  const [daily, adjustment, basic, limits, membership, weight] = await Promise.all([
    prisma.daily.aggregate({
      where: { tsCode: oldTsCode },
      _min: { tradeDate: true },
    }),
    prisma.adjFactor.aggregate({
      where: { tsCode: oldTsCode },
      _min: { tradeDate: true },
    }),
    prisma.dailyBasic.aggregate({
      where: { tsCode: oldTsCode },
      _min: { tradeDate: true },
    }),
    prisma.stkLimit.aggregate({
      where: { tsCode: oldTsCode },
      _min: { tradeDate: true },
    }),
    prisma.swIndustryMember.aggregate({
      where: { tsCode: oldTsCode },
      _min: { inDate: true },
    }),
    prisma.indexWeight.aggregate({
      where: { conCode: oldTsCode },
      _min: { tradeDate: true },
    }),
  ]);
  const dates = [
    daily._min.tradeDate,
    adjustment._min.tradeDate,
    basic._min.tradeDate,
    limits._min.tradeDate,
    membership._min.inDate,
    weight._min.tradeDate,
  ].filter((date): date is string => date != null);
  return dates.sort()[0] ?? null;
}
