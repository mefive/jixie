import { prisma } from '../src/lib/prisma.js';
import { assertProductionLock, runDailyMaintenance } from '../src/maintenance/daily.js';
import { recoverInterruptedMaintenanceRuns } from '../src/maintenance/state.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const dates = args.filter((argument) => !argument.startsWith('--'));
  if (
    dates.length > 1 ||
    args.some((argument) => argument.startsWith('--') && argument !== '--force')
  ) {
    throw new Error('Usage: pnpm --filter api maintenance:daily [YYYYMMDD] [--force]');
  }
  const targetDate = dates[0];
  if (targetDate && !/^\d{8}$/.test(targetDate)) {
    throw new Error('Target date must use YYYYMMDD');
  }

  assertProductionLock();
  const recovered = await recoverInterruptedMaintenanceRuns();
  if (recovered > 0) {
    console.warn(`[maintenance:daily] recovered ${recovered} interrupted run(s)`);
  }
  const summary = await runDailyMaintenance({ targetDate, force });
  console.log('[maintenance:daily] complete', summary);
}

main()
  .catch((error: unknown) => {
    console.error(
      '[maintenance:daily] failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
