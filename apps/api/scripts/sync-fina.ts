import { loadTushareConfig } from '../src/config.js';
import {
  syncFinancialStatementsByStock,
  type FinancialStatementSyncSummary,
} from '../src/fundamentals/sync.js';
import { prisma } from '../src/lib/prisma.js';
import {
  addReferenceSyncSummary,
  chunkReferenceCodes,
  emptyReferenceSyncSummary,
  runReferenceWorkerProcess,
} from '../src/maintenance/reference-worker-process.js';
import type { ReferenceWorkerStage } from '../src/maintenance/reference-worker.js';
import {
  financialHistoryStart,
  quarterlyReportPeriods,
} from '../src/maintenance/reference-periods.js';
import { stockCodesWithDailyData } from '../src/store/sync.js';
import { TushareClient } from '../src/tushare/client.js';

/**
 * Sync raw statement versions, fina_indicator, and dividend history into the local store. The two
 * all-market financial sources use VIP report-period pagination. Dividend history remains per-stock.
 * Every full-history stage runs in bounded child processes.
 */
async function main(): Promise<void> {
  const cfg = loadTushareConfig();
  const interval = Math.max(cfg.minIntervalMs, 800);
  const repairCode = argumentValue(process.argv.slice(2), '--repair-code');
  if (repairCode) {
    await repairFinancialStatements(repairCode, cfg, process.argv.slice(2));
    return;
  }
  const financialChunkSize = positiveInteger(
    process.env.MAINTENANCE_WEEKLY_FINANCIAL_PERIODS_PER_PROCESS,
    1,
  );
  const dividendChunkSize = positiveInteger(
    process.env.MAINTENANCE_WEEKLY_DIVIDEND_CODES_PER_PROCESS,
    200,
  );

  console.log(
    `Syncing financials (statement versions + indicators by VIP period, per-stock dividend, rate limit ${interval}ms/call)\n`,
  );
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
    shanghaiToday(),
  );
  const dividendRows = await prisma.dividend.findMany({
    distinct: ['tsCode'],
    select: { tsCode: true },
  });
  const dividendExisting = new Set(dividendRows.map((row) => row.tsCode));

  await syncStage('financial_statements', financialPeriods, financialChunkSize);
  await syncStage('financials', financialPeriods, financialChunkSize);
  await syncStage(
    'dividends',
    allCodes.filter((code) => !dividendExisting.has(code)),
    dividendChunkSize,
  );

  console.log('\nStored row counts:');
  console.table({
    financial_income_statement: await prisma.financialIncomeStatement.count(),
    financial_balance_sheet: await prisma.financialBalanceSheet.count(),
    financial_cash_flow_statement: await prisma.financialCashFlowStatement.count(),
    fina_indicator: await prisma.finaIndicator.count(),
    dividend: await prisma.dividend.count(),
  });

  await prisma.$disconnect();
  console.log('✅ Financial sync complete');
}

async function repairFinancialStatements(
  code: string,
  config: ReturnType<typeof loadTushareConfig>,
  args: string[],
): Promise<FinancialStatementSyncSummary> {
  if (!/^\d{6}\.(?:SH|SZ|BJ)$/.test(code)) {
    throw new Error('--repair-code must be an A-share ts_code');
  }
  const startDate = argumentValue(args, '--start');
  const endDate = argumentValue(args, '--end') ?? shanghaiToday();
  if (!startDate) {
    throw new Error('--repair-code requires --start YYYYMMDD');
  }
  const client = new TushareClient({
    token: config.token,
    baseUrl: config.baseUrl,
    minIntervalMs: Math.max(config.minIntervalMs, 800),
  });
  const summary = await syncFinancialStatementsByStock(client, [code], { startDate, endDate });
  console.table(summary);
  await prisma.$disconnect();
  return summary;
}

async function syncStage(
  stage: ReferenceWorkerStage,
  codes: string[],
  chunkSize: number,
): Promise<void> {
  const chunks = chunkReferenceCodes(codes, chunkSize);
  let summary = emptyReferenceSyncSummary();

  for (const [index, chunk] of chunks.entries()) {
    console.log(`  ${stage} process ${index + 1}/${chunks.length}: ${chunk.length} items`);
    const current = await runReferenceWorkerProcess(stage, null, chunk);
    summary = addReferenceSyncSummary(summary, current);
  }
  console.log(`  ${stage} complete: ${summary.processed} processed, ${summary.changed} changed`);
}

function shanghaiToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date())
    .replaceAll('-', '');
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function argumentValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

main().catch(async (e: unknown) => {
  console.error('\n❌ sync:fina failed: ', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
