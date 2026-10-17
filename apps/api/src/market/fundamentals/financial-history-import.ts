import { prisma } from '#infra/database/prisma.js';
import { stockCodesWithDailyData } from '../stocks/read.js';
import { financialHistoryStart, quarterlyReportPeriods } from './reference-periods.js';
import type { ReferenceSyncSummary } from './reference-sync.js';
import {
  addReferenceSyncSummary,
  chunkReferenceCodes,
  emptyReferenceSyncSummary,
  runReferenceWorkerProcess,
} from './reference-worker-process.js';
import type { ReferenceWorkerStage } from './reference-worker-protocol.js';

/**
 * 限定财务参考历史导入的区间与证券。
 * Configure dates and instruments for financial reference import.
 */
export interface FinancialReferenceImportOptions {
  throughDate: string;
  financialPeriodsPerProcess: number;
  dividendCodesPerProcess: number;
  onLog?: (line: string) => void;
}

/**
 * 汇总财务历史导入的新增、修订与覆盖。
 * Summarize imported financial additions, corrections and coverage.
 */
export interface FinancialReferenceImportSummary {
  financialStatements: ReferenceSyncSummary;
  financials: ReferenceSyncSummary;
  dividends: ReferenceSyncSummary;
}

/**
 * 导入财务参考历史并记录覆盖与修订结果，供 PIT 基线修复。
 * Import financial reference history and record coverage and corrections for PIT baseline repair.
 */
export async function importFinancialReferenceHistory(
  options: FinancialReferenceImportOptions,
): Promise<FinancialReferenceImportSummary> {
  const onLog = options.onLog ?? ((line: string) => console.log(line));
  const allCodes = await stockCodesWithDailyData();
  const earliestMarketRow = await prisma.daily.findFirst({
    orderBy: { tradeDate: 'asc' },
    select: { tradeDate: true },
  });
  if (!earliestMarketRow) {
    throw new Error('Daily is empty; import market bars before financial references');
  }
  const financialPeriods = quarterlyReportPeriods(
    financialHistoryStart(earliestMarketRow.tradeDate),
    options.throughDate,
  );
  const dividendRows = await prisma.dividend.findMany({
    distinct: ['tsCode'],
    select: { tsCode: true },
  });
  const dividendExisting = new Set(dividendRows.map((row) => row.tsCode));

  const financialStatements = await syncStage(
    'financial_statements',
    financialPeriods,
    options.financialPeriodsPerProcess,
    onLog,
  );
  const financials = await syncStage(
    'financials',
    financialPeriods,
    options.financialPeriodsPerProcess,
    onLog,
  );
  const dividends = await syncStage(
    'dividends',
    allCodes.filter((code) => !dividendExisting.has(code)),
    options.dividendCodesPerProcess,
    onLog,
  );

  return { financialStatements, financials, dividends };
}

async function syncStage(
  stage: ReferenceWorkerStage,
  codes: string[],
  chunkSize: number,
  onLog: (line: string) => void,
): Promise<ReferenceSyncSummary> {
  const chunks = chunkReferenceCodes(codes, chunkSize);
  let summary = emptyReferenceSyncSummary();

  for (const [index, chunk] of chunks.entries()) {
    onLog(`  ${stage} process ${index + 1}/${chunks.length}: ${chunk.length} items`);
    const current = await runReferenceWorkerProcess(stage, chunk);
    summary = addReferenceSyncSummary(summary, current);
  }
  onLog(`  ${stage} complete: ${summary.processed} processed, ${summary.changed} changed`);
  return summary;
}
