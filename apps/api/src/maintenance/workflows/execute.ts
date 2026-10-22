import { assertProductionLock } from '../runs/coordination.js';
import { recoverInterruptedMaintenanceRuns } from '../runs/state.js';
import { runDailyMaintenance } from './daily.js';
import { runRepairMaintenance } from './repair.js';
import { parseRepairArguments } from './repair-arguments.js';
import { runWeeklyMaintenance } from './weekly.js';
import { importMarketData } from './import.js';
import { executeMarketSync } from '#market/sync/dispatch.js';
import { canonicalizeStockCodes } from '#market/instruments/canonicalize-stock-codes.js';
import type { MaintenanceCommand } from '../staging/manifest.js';

type WorkflowKind = 'daily' | 'weekly' | 'repair';

/** 在绑定候选连接和运行上下文后分派工作流。 / Dispatch workflows only inside bound candidate and execution scopes. */
export async function executeMaintenanceWorkflow(
  command: MaintenanceCommand,
  args: string[],
): Promise<void> {
  assertProductionLock();
  switch (command) {
    case 'daily':
      return runDaily(args);
    case 'weekly':
      return runWeekly(args);
    case 'repair':
      return runRepair(args);
    case 'import':
      return importMarketData(args);
    case 'sync':
      return executeMarketSync(args);
    case 'canonicalize':
      await canonicalizeStockCodes();
      return;
  }
}

async function recoverInterruptedRuns(kind: WorkflowKind): Promise<void> {
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
  const summary = await runDailyMaintenance({
    targetDate,
    force,
    resumeOnly,
    initializeOnly,
    deferPublication: true,
  });
  console.log('[maintenance:daily] complete', summary);
}

async function runWeekly(args: string[]): Promise<void> {
  if (args.some((argument) => argument !== '--force')) {
    throw new Error('Usage: pnpm maintenance weekly [--force]');
  }

  await recoverInterruptedRuns('weekly');
  const summary = await runWeeklyMaintenance({
    force: args.includes('--force'),
    deferPublication: true,
  });
  console.log('[maintenance:weekly] complete', summary);
}

async function runRepair(args: string[]): Promise<void> {
  const options = parseRepairArguments(args);

  await recoverInterruptedRuns('repair');
  await runRepairMaintenance({ ...options, deferPublication: true });
}

function assertDate(value: string | undefined, label: string): void {
  if (value && !/^\d{8}$/.test(value)) {
    throw new Error(`${label} must use YYYYMMDD`);
  }
}
