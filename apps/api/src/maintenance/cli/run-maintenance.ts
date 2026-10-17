import { prisma } from '#infra/database/prisma.js';
import { assertProductionLock } from '../runs/coordination.js';
import { recoverInterruptedMaintenanceRuns } from '../runs/state.js';
import { repairBaseline } from '../workflows/baseline-repair.js';
import { runDailyMaintenance } from '../workflows/daily.js';
import { runRepairMaintenance } from '../workflows/repair.js';
import { runWeeklyMaintenance } from '../workflows/weekly.js';

/**
 * 区分维护 CLI 的日更、修复等命令，供入口分派。
 *
 * Identify maintenance CLI commands for entry-point dispatch.
 */
type MaintenanceCommand = 'daily' | 'weekly' | 'repair' | 'baseline';

/**
 * 解析维护命令、执行对应工作流并负责进程与数据库收尾。
 *
 * Parse and dispatch maintenance commands and close process and database resources.
 */
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

/**
 * 解析维护子命令并校验支持范围。
 *
 * Resolve and validate a maintenance subcommand.
 */
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

/**
 * 组合日更参数并执行维护，向 CLI 输出本轮进度和结果。
 *
 * Prepare and run daily maintenance and report progress and results to the CLI.
 */
async function runDaily(args: string[]): Promise<void> {
  const force = args.includes('--force');
  const resumeOnly = args.includes('--resume-only');
  const initializeOnly = args.includes('--initialize-only');
  const dates = args.filter((argument) => !argument.startsWith('--'));
  if (
    dates.length > 1 ||
    args.some(
      (argument) =>
        argument.startsWith('--') &&
        !['--force', '--resume-only', '--initialize-only'].includes(argument),
    ) ||
    ((resumeOnly || initializeOnly) && (dates.length > 0 || force)) ||
    (resumeOnly && initializeOnly)
  ) {
    throw new Error(
      'Usage: pnpm maintenance daily [YYYYMMDD] [--force] | daily --resume-only | daily --initialize-only',
    );
  }
  const targetDate = dates[0];
  assertDate(targetDate, 'Target date');

  await recoverInterruptedRuns('daily');
  const summary = await runDailyMaintenance({ targetDate, force, resumeOnly, initializeOnly });
  console.log('[maintenance:daily] complete', summary);
  if (summary?.retryForNewTarget && !resumeOnly && process.env.INVOCATION_ID) {
    console.log(
      '[maintenance:daily] Original target completed; schedule a separate catch-up attempt',
    );
    process.exitCode = 75;
  }
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

  const summary = await repairBaseline(argument);
  console.log('[maintenance:baseline] complete', summary);
}

function assertDate(value: string | undefined, label: string): void {
  if (value && !/^\d{8}$/.test(value)) {
    throw new Error(`${label} must use YYYYMMDD`);
  }
}

main()
  .catch((error: unknown) => {
    console.error('[maintenance] failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
