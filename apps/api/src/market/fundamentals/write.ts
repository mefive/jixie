import { mergeDividendSource } from './dividend-selection.js';
import { DIVIDEND_DATE_FIELDS } from './dividend-identity.js';
import { nextVerifiedSession } from '../calendar/coverage.js';
import { z } from 'zod';
import type {
  MarketPartition,
  MarketTransaction,
  PreparedTable,
  AcceptedMarketPartition,
  PreparedMarketPartition,
} from '../synchronization/partition.js';
import {
  collectWriteResult,
  emptyWriteResult,
  mergeRows,
  hasValueConflict,
} from '../synchronization/rows.js';
import { localDate } from '../synchronization/date.js';
import {
  finaIndicatorSchema,
  finaIndicatorVersionSchema,
  mergeIndicatorSnapshot,
} from './indicator-selection.js';

const financialIncomeStatementSchema = z.strictObject({
  sourceTsCode: z.string().nullish(),
  id: z.string(),
  source: z.string(),
  contractVersion: z.number().int(),
  tsCode: z.string(),
  annDate: z.string().nullish(),
  fAnnDate: z.string().nullish(),
  endDate: z.string(),
  reportType: z.string(),
  compType: z.string(),
  updateFlag: z.string().nullish(),
  observedAt: z.date(),
  sourceRowFingerprint: z.string(),
  announcementDate: z.string(),
  availableDate: z.string(),
  availabilityQuality: z.string(),
  evidenceSource: z.string(),
  evidenceId: z.string().nullish(),
  totalRevenue: z.number().finite().nullish(),
  revenue: z.number().finite().nullish(),
  operCost: z.number().finite().nullish(),
  operateProfit: z.number().finite().nullish(),
  totalProfit: z.number().finite().nullish(),
  incomeTax: z.number().finite().nullish(),
  nIncome: z.number().finite().nullish(),
  nIncomeAttrP: z.number().finite().nullish(),
  ebit: z.number().finite().nullish(),
  rdExp: z.number().finite().nullish(),
  finExpIntExp: z.number().finite().nullish(),
});

const financialBalanceSheetSchema = z.strictObject({
  sourceTsCode: z.string().nullish(),
  id: z.string(),
  source: z.string(),
  contractVersion: z.number().int(),
  tsCode: z.string(),
  annDate: z.string().nullish(),
  fAnnDate: z.string().nullish(),
  endDate: z.string(),
  reportType: z.string(),
  compType: z.string(),
  updateFlag: z.string().nullish(),
  observedAt: z.date(),
  sourceRowFingerprint: z.string(),
  announcementDate: z.string(),
  availableDate: z.string(),
  availabilityQuality: z.string(),
  evidenceSource: z.string(),
  evidenceId: z.string().nullish(),
  moneyCap: z.number().finite().nullish(),
  tradAsset: z.number().finite().nullish(),
  notesReceiv: z.number().finite().nullish(),
  accountsReceiv: z.number().finite().nullish(),
  accountsReceivBill: z.number().finite().nullish(),
  othReceiv: z.number().finite().nullish(),
  othRcvTotal: z.number().finite().nullish(),
  inventories: z.number().finite().nullish(),
  prepayment: z.number().finite().nullish(),
  contractAssets: z.number().finite().nullish(),
  othCurAssets: z.number().finite().nullish(),
  totalCurAssets: z.number().finite().nullish(),
  fixAssets: z.number().finite().nullish(),
  fixAssetsTotal: z.number().finite().nullish(),
  cip: z.number().finite().nullish(),
  cipTotal: z.number().finite().nullish(),
  intanAssets: z.number().finite().nullish(),
  goodwill: z.number().finite().nullish(),
  deferTaxAssets: z.number().finite().nullish(),
  othNca: z.number().finite().nullish(),
  totalNca: z.number().finite().nullish(),
  totalAssets: z.number().finite().nullish(),
  notesPayable: z.number().finite().nullish(),
  acctPayable: z.number().finite().nullish(),
  accountsPay: z.number().finite().nullish(),
  advReceipts: z.number().finite().nullish(),
  contractLiab: z.number().finite().nullish(),
  payrollPayable: z.number().finite().nullish(),
  taxesPayable: z.number().finite().nullish(),
  othPayable: z.number().finite().nullish(),
  othPayTotal: z.number().finite().nullish(),
  stBorr: z.number().finite().nullish(),
  nonCurLiabDue1y: z.number().finite().nullish(),
  ltBorr: z.number().finite().nullish(),
  bondPayable: z.number().finite().nullish(),
  othCurLiab: z.number().finite().nullish(),
  totalCurLiab: z.number().finite().nullish(),
  othNcl: z.number().finite().nullish(),
  totalNcl: z.number().finite().nullish(),
  totalLiab: z.number().finite().nullish(),
  minorityInt: z.number().finite().nullish(),
  totalHldrEqyExcMinInt: z.number().finite().nullish(),
  totalShare: z.number().finite().nullish(),
});

const financialCashFlowStatementSchema = z.strictObject({
  sourceTsCode: z.string().nullish(),
  id: z.string(),
  source: z.string(),
  contractVersion: z.number().int(),
  tsCode: z.string(),
  annDate: z.string().nullish(),
  fAnnDate: z.string().nullish(),
  endDate: z.string(),
  reportType: z.string(),
  compType: z.string(),
  updateFlag: z.string().nullish(),
  observedAt: z.date(),
  sourceRowFingerprint: z.string(),
  announcementDate: z.string(),
  availableDate: z.string(),
  availabilityQuality: z.string(),
  evidenceSource: z.string(),
  evidenceId: z.string().nullish(),
  nCashflowAct: z.number().finite().nullish(),
  cPayAcqConstFiolta: z.number().finite().nullish(),
  nCashflowInvAct: z.number().finite().nullish(),
  nCashFlowsFncAct: z.number().finite().nullish(),
  cPayDistDpcpIntExp: z.number().finite().nullish(),
  nIncrCashCashEqu: z.number().finite().nullish(),
  cCashEquBegPeriod: z.number().finite().nullish(),
  cCashEquEndPeriod: z.number().finite().nullish(),
  netProfit: z.number().finite().nullish(),
  deprFaCogaDpba: z.number().finite().nullish(),
  amortIntangAssets: z.number().finite().nullish(),
  freeCashflow: z.number().finite().nullish(),
});

const dividendSchema = z.strictObject({
  sourceTsCode: z.string().nullish(),
  id: z.string(),
  tsCode: z.string(),
  endDate: z.string(),
  annDate: z.string().nullish(),
  exDate: z.string().nullish(),
  divProc: z.literal('实施'),
  cashDiv: z.number().finite().nullish(),
  cashDivTax: z.number().finite().nullish(),
  baseDate: z.string().nullish(),
  baseShare: z.number().finite().nullish(),
  observedAt: z.date().nullish(),
  availabilityQuality: z.string().optional(),
  distributionKind: z.enum(['cash', 'shares', 'mixed', 'none', 'unspecified']).nullish(),
  stockDividend: z.number().finite().nonnegative().nullish(),
  stockBonusRate: z.number().finite().nonnegative().nullish(),
  stockCapitalizationRate: z.number().finite().nonnegative().nullish(),
  recordDate: z.string().nullish(),
  payDate: z.string().nullish(),
  implementationAnnouncementDate: z.string().nullish(),
  shareListingDate: z.string().nullish(),
});

/**
 * 显式写入本领域的表，校验与数据变化随调用者事务提交。
 *
 * Write this domain's declared tables within the caller's transaction.
 */
export async function writeFinancialPartition(
  transaction: MarketTransaction,
  prepared: PreparedMarketPartition,
  partition: MarketPartition,
  fetchedAt: Date,
) {
  const result = emptyWriteResult();

  for (const batch of prepared.tables) {
    switch (batch.table) {
      case 'FinancialIncomeStatement':
        await writeFinancialIncomeStatement(transaction, batch, result);
        break;
      case 'FinancialBalanceSheet':
        await writeFinancialBalanceSheet(transaction, batch, result);
        break;
      case 'FinancialCashFlowStatement':
        await writeFinancialCashFlowStatement(transaction, batch, result);
        break;
      case 'FinaIndicator':
        await writeFinaIndicator(transaction, batch, result);
        break;
      case 'FinaIndicatorVersion':
        await writeFinaIndicatorVersion(transaction, batch, result);
        break;
      case 'Dividend':
        await writeDividend(transaction, batch, prepared, partition, fetchedAt, result);
        break;
      default:
        throw new Error(`Unexpected fundamentals table ${batch.table}`);
    }
  }

  return result;
}

/**
 * 写入 FinancialIncomeStatement 的业务记录。
 *
 * Persist typed FinancialIncomeStatement records.
 */
async function writeFinancialIncomeStatement(
  transaction: MarketTransaction,
  batch: PreparedTable,
  result: AcceptedMarketPartition,
) {
  const existing = await transaction.financialIncomeStatement.findMany({
    where: {
      sourceRowFingerprint: {
        in: batch.records.flatMap((record) =>
          typeof record.values.sourceRowFingerprint === 'string'
            ? [record.values.sourceRowFingerprint]
            : [],
        ),
      },
    },
  });
  const rows = mergeRows({
    schema: financialIncomeStatementSchema,
    keys: ['sourceRowFingerprint'],
    ignoredDuplicateFields: ['id', 'observedAt'],
    records: batch.records,
    existing,
    replace: false,
    atomic: batch.atomic,
    transform: (values, before) =>
      before ? { ...values, id: before.id, observedAt: before.observedAt } : values,
  });

  for (const row of rows.updated) {
    await transaction.financialIncomeStatement.update({
      where: { sourceRowFingerprint: row.sourceRowFingerprint },
      data: row,
    });
  }
  if (rows.inserted.length) {
    await transaction.financialIncomeStatement.createMany({ data: rows.inserted });
  }
  collectWriteResult(result, rows);
}

/**
 * 写入 FinancialBalanceSheet 的业务记录。
 *
 * Persist typed FinancialBalanceSheet records.
 */
async function writeFinancialBalanceSheet(
  transaction: MarketTransaction,
  batch: PreparedTable,
  result: AcceptedMarketPartition,
) {
  const existing = await transaction.financialBalanceSheet.findMany({
    where: {
      sourceRowFingerprint: {
        in: batch.records.flatMap((record) =>
          typeof record.values.sourceRowFingerprint === 'string'
            ? [record.values.sourceRowFingerprint]
            : [],
        ),
      },
    },
  });
  const rows = mergeRows({
    schema: financialBalanceSheetSchema,
    keys: ['sourceRowFingerprint'],
    ignoredDuplicateFields: ['id', 'observedAt'],
    records: batch.records,
    existing,
    replace: false,
    atomic: batch.atomic,
    transform: (values, before) =>
      before ? { ...values, id: before.id, observedAt: before.observedAt } : values,
  });

  for (const row of rows.updated) {
    await transaction.financialBalanceSheet.update({
      where: { sourceRowFingerprint: row.sourceRowFingerprint },
      data: row,
    });
  }
  if (rows.inserted.length) {
    await transaction.financialBalanceSheet.createMany({ data: rows.inserted });
  }
  collectWriteResult(result, rows);
}

/**
 * 写入 FinancialCashFlowStatement 的业务记录。
 *
 * Persist typed FinancialCashFlowStatement records.
 */
async function writeFinancialCashFlowStatement(
  transaction: MarketTransaction,
  batch: PreparedTable,
  result: AcceptedMarketPartition,
) {
  const existing = await transaction.financialCashFlowStatement.findMany({
    where: {
      sourceRowFingerprint: {
        in: batch.records.flatMap((record) =>
          typeof record.values.sourceRowFingerprint === 'string'
            ? [record.values.sourceRowFingerprint]
            : [],
        ),
      },
    },
  });
  const rows = mergeRows({
    schema: financialCashFlowStatementSchema,
    keys: ['sourceRowFingerprint'],
    ignoredDuplicateFields: ['id', 'observedAt'],
    records: batch.records,
    existing,
    replace: false,
    atomic: batch.atomic,
    transform: (values, before) =>
      before ? { ...values, id: before.id, observedAt: before.observedAt } : values,
  });

  for (const row of rows.updated) {
    await transaction.financialCashFlowStatement.update({
      where: { sourceRowFingerprint: row.sourceRowFingerprint },
      data: row,
    });
  }
  if (rows.inserted.length) {
    await transaction.financialCashFlowStatement.createMany({ data: rows.inserted });
  }
  collectWriteResult(result, rows);
}

/**
 * 写入 FinaIndicator 的业务记录。
 *
 * Persist typed FinaIndicator records.
 */
async function writeFinaIndicator(
  transaction: MarketTransaction,
  batch: PreparedTable,
  result: AcceptedMarketPartition,
) {
  const existing = await transaction.finaIndicator.findMany({
    where: {
      tsCode: { in: [...new Set(batch.records.map((record) => String(record.values.tsCode)))] },
      endDate: { in: [...new Set(batch.records.map((record) => String(record.values.endDate)))] },
    },
  });
  const records = new Map(
    batch.records.map((record) => [
      JSON.stringify([record.values.tsCode, record.values.endDate]),
      record,
    ]),
  );
  const rows = mergeRows({
    schema: finaIndicatorSchema,
    keys: ['tsCode', 'endDate'],
    transform: (values, before) =>
      mergeIndicatorSnapshot(before, records.get(JSON.stringify([values.tsCode, values.endDate]))!),
    records: batch.records,
    existing,
    replace: false,
    atomic: batch.atomic,
  });

  for (const row of rows.updated) {
    await transaction.finaIndicator.update({
      where: { tsCode_endDate: { tsCode: row.tsCode, endDate: row.endDate } },
      data: row,
    });
  }
  if (rows.inserted.length) {
    await transaction.finaIndicator.createMany({ data: rows.inserted });
  }
  collectWriteResult(result, rows);
}

/**
 * 写入 FinaIndicatorVersion 的业务记录。
 *
 * Persist typed FinaIndicatorVersion records.
 */
async function writeFinaIndicatorVersion(
  transaction: MarketTransaction,
  batch: PreparedTable,
  result: AcceptedMarketPartition,
) {
  const existing = await transaction.finaIndicatorVersion.findMany({
    where: {
      sourceFingerprint: {
        in: batch.records.flatMap((record) =>
          typeof record.values.sourceFingerprint === 'string'
            ? [record.values.sourceFingerprint]
            : [],
        ),
      },
    },
  });
  const availableByCapture = new Map<string, string>();
  for (const row of existing.filter((value) => value.availabilityQuality === 'unknown')) {
    const date = localDate(row.observedAt);
    if (!availableByCapture.has(date)) {
      const next = await nextVerifiedSession(date, transaction);
      if (next) {
        availableByCapture.set(date, next);
      }
    }
  }
  const rows = mergeRows({
    schema: finaIndicatorVersionSchema,
    keys: ['sourceFingerprint'],
    ignoredDuplicateFields: ['id', 'observedAt', 'availableDate', 'availabilityQuality'],
    records: batch.records,
    existing,
    replace: false,
    atomic: batch.atomic,
    transform: (values, before) => {
      if (!before) {
        return values;
      }
      const next =
        before.observedAt instanceof Date
          ? availableByCapture.get(localDate(before.observedAt))
          : undefined;
      return {
        ...values,
        id: before.id,
        observedAt: before.observedAt,
        availableDate: next ?? before.availableDate,
        availabilityQuality: next ? 'latest_only' : before.availabilityQuality,
      };
    },
  });

  for (const row of rows.updated) {
    await transaction.finaIndicatorVersion.update({
      where: { sourceFingerprint: row.sourceFingerprint },
      data: row,
    });
  }
  if (rows.inserted.length) {
    await transaction.finaIndicatorVersion.createMany({ data: rows.inserted });
  }
  collectWriteResult(result, rows);
}

/**
 * 写入 Dividend 的业务记录。
 *
 * Persist typed Dividend records.
 */
async function writeDividend(
  transaction: MarketTransaction,
  batch: PreparedTable,
  prepared: PreparedMarketPartition,
  partition: MarketPartition,
  fetchedAt: Date,
  result: AcceptedMarketPartition,
) {
  const daily = DIVIDEND_DATE_FIELDS.some((field) => field === partition.scope);

  // 新采集与完整历史替换都只作用于实施记录，保留旧预案及其他阶段。
  // Admission and full-history replacement affect implementations only, preserving legacy stages.
  const existing = await transaction.dividend.findMany({
    where: {
      divProc: '实施',
      ...(daily
        ? { id: { in: [...new Set(batch.records.map(({ values }) => String(values.id)))] } }
        : {
            tsCode: partition.scope,
            endDate: { gte: partition.startDate, lte: partition.endDate },
          }),
    },
  });
  const rows = mergeRows({
    schema: dividendSchema,
    merge: mergeDividendSource,
    keys: ['id'],
    records: batch.records,
    existing: existing.map((row) => dividendSchema.parse(row)),
    replace:
      batch.replace &&
      ((prepared.status === 'complete' && !prepared.errors.length) ||
        (batch.atomic === true && prepared.checks.terminalPage && !prepared.checks.sourceFailed)),
    atomic: batch.atomic,
    transform: (values, before) => {
      if (values === before) {
        return before;
      }
      const unchanged =
        before?.observedAt instanceof Date &&
        !hasValueConflict(
          before,
          Object.fromEntries(
            Object.entries(values).filter(
              ([field]) =>
                !['observedAt', 'availabilityQuality', 'distributionKind', 'sourceTsCode'].includes(
                  field,
                ),
            ),
          ),
        );

      return {
        ...values,
        observedAt: unchanged ? before.observedAt : fetchedAt,
        availabilityQuality: 'latest_only',
      };
    },
  });

  for (const row of rows.updated) {
    await transaction.dividend.update({ where: { id: row.id }, data: row });
  }
  if (rows.inserted.length) {
    await transaction.dividend.createMany({ data: rows.inserted });
  }
  for (let offset = 0; offset < rows.deleted.length; offset += 200) {
    await transaction.dividend.deleteMany({
      where: { OR: rows.deleted.slice(offset, offset + 200).map((row) => ({ id: row.id })) },
    });
  }
  collectWriteResult(result, rows);
}
