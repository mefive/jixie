import { prisma } from '../src/lib/prisma.js';
import { assertProductionLock } from '../src/maintenance/daily.js';
import { runWeeklyMaintenance } from '../src/maintenance/weekly.js';
import { recoverInterruptedMaintenanceRuns } from '../src/maintenance/state.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((argument) => argument !== '--force')) {
    throw new Error('Usage: pnpm --filter api maintenance:weekly [--force]');
  }
  assertProductionLock();
  const recovered = await recoverInterruptedMaintenanceRuns();
  if (recovered > 0) {
    console.warn(`[maintenance:weekly] recovered ${recovered} interrupted run(s)`);
  }
  const summary = await runWeeklyMaintenance({ force: args.includes('--force') });
  console.log('[maintenance:weekly] complete', summary);
}

main()
  .catch((error: unknown) => {
    console.error(
      '[maintenance:weekly] failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
