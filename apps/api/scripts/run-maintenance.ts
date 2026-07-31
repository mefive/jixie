import { loadTushareConfig } from '../src/config.js';
import { prisma } from '../src/lib/prisma.js';
import { syncMarketIndicators } from '../src/market/sync-market-indicators.js';
import { assertProductionLock, runDailyMaintenance } from '../src/maintenance/daily.js';
import { validateDerivedMarketRange } from '../src/maintenance/quality.js';
import { runRepairMaintenance } from '../src/maintenance/repair.js';
import { recentPublishedTradingDates, selfHealMarketDates } from '../src/maintenance/self-heal.js';
import { recoverInterruptedMaintenanceRuns } from '../src/maintenance/state.js';
import { runWeeklyMaintenance } from '../src/maintenance/weekly.js';
import { latestCompletedTradeDate } from '../src/signals/service.js';
import { TushareClient } from '../src/tushare/client.js';

type MaintenanceCommand = 'daily' | 'weekly' | 'repair' | 'baseline';

async function main(): Promise<void> {
  const [firstArgument, ...remainingArguments] = process.argv.slice(2);
  const command = maintenanceCommand(firstArgument);
  const args =
    command === 'daily' && firstArgument !== 'daily' ? process.argv.slice(2) : remainingArguments;

  switch (command) {
    case 'daily':
      await runDaily(args);
      break;
    case 'weekly':
      await runWeekly(args);
      break;
    case 'repair':
      await runRepair(args);
      break;
    case 'baseline':
      await healBaseline(args);
      break;
  }
}

function maintenanceCommand(argument: string | undefined): MaintenanceCommand {
  if (!argument || argument === 'daily' || argument.startsWith('--') || /^\d{8}$/.test(argument)) {
    return 'daily';
  }
  if (argument === 'weekly' || argument === 'repair' || argument === 'baseline') {
    return argument;
  }

  throw new Error(
    'Usage: pnpm maintenance [daily [YYYYMMDD] [--force] | weekly [--force] | repair YYYYMMDD YYYYMMDD]',
  );
}

async function recoverInterruptedRuns(
  kind: Exclude<MaintenanceCommand, 'baseline'>,
): Promise<void> {
  assertProductionLock();
  const recovered = await recoverInterruptedMaintenanceRuns();
  if (recovered > 0) {
    console.warn(`[maintenance:${kind}] recovered ${recovered} interrupted run(s)`);
  }
}

async function runDaily(args: string[]): Promise<void> {
  const force = args.includes('--force');
  const dates = args.filter((argument) => !argument.startsWith('--'));
  if (
    dates.length > 1 ||
    args.some((argument) => argument.startsWith('--') && argument !== '--force')
  ) {
    throw new Error('Usage: pnpm maintenance [daily] [YYYYMMDD] [--force]');
  }
  const targetDate = dates[0];
  assertDate(targetDate, 'Target date');

  await recoverInterruptedRuns('daily');
  const summary = await runDailyMaintenance({ targetDate, force });
  console.log('[maintenance:daily] complete', summary);
}

async function runWeekly(args: string[]): Promise<void> {
  if (args.some((argument) => argument !== '--force')) {
    throw new Error('Usage: pnpm maintenance weekly [--force]');
  }

  await recoverInterruptedRuns('weekly');
  const summary = await runWeeklyMaintenance({ force: args.includes('--force') });
  console.log('[maintenance:weekly] complete', summary);
}

async function runRepair(args: string[]): Promise<void> {
  const [startDate, endDate, ...rest] = args;
  if (!startDate || !endDate || rest.length > 0) {
    throw new Error('Usage: pnpm maintenance repair YYYYMMDD YYYYMMDD');
  }
  assertDate(startDate, 'Start date');
  assertDate(endDate, 'End date');

  await recoverInterruptedRuns('repair');
  await runRepairMaintenance(startDate, endDate);
  console.log(`[maintenance:repair] complete ${startDate}..${endDate}`);
}

async function healBaseline(args: string[]): Promise<void> {
  const [argument, ...rest] = args;
  if (rest.length > 0) {
    throw new Error('Usage: pnpm maintenance baseline [YYYYMMDD]');
  }
  assertDate(argument, 'Baseline date');
  assertProductionLock();

  const latestCompleted = await latestCompletedTradeDate();
  if (!latestCompleted) {
    throw new Error('No completed SSE trading date is available');
  }
  const through = argument && argument < latestCompleted ? argument : latestCompleted;
  const lookback = positiveInteger(process.env.MAINTENANCE_BASELINE_REPAIR_LOOKBACK_DAYS, 20);
  const dates = await recentPublishedTradingDates(through, lookback);
  if (dates.length === 0) {
    throw new Error(`No open trading dates are available through ${through}`);
  }

  const config = loadTushareConfig();
  const client = new TushareClient({
    token: config.token,
    baseUrl: config.baseUrl,
    minIntervalMs: config.minIntervalMs,
  });
  const summary = await selfHealMarketDates(client, dates, {
    maxRepairDates: lookback,
  });
  if (summary.deferredDates.length > 0) {
    throw new Error(`Baseline self-heal deferred ${summary.deferredDates.length} dates`);
  }
  if (summary.earliestDerivedChange) {
    const affectedDates = dates.filter((date) => date >= summary.earliestDerivedChange!);
    await syncMarketIndicators(summary.earliestDerivedChange, dates.at(-1)!);
    await validateDerivedMarketRange(summary.earliestDerivedChange, dates.at(-1)!, affectedDates);
  }
  console.log('[maintenance:baseline] complete', summary);
}

function assertDate(value: string | undefined, label: string): void {
  if (value && !/^\d{8}$/.test(value)) {
    throw new Error(`${label} must use YYYYMMDD`);
  }
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

main()
  .catch((error: unknown) => {
    console.error('[maintenance] failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
