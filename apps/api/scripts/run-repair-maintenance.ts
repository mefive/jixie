import { prisma } from '../src/lib/prisma.js';
import { assertProductionLock } from '../src/maintenance/daily.js';
import { runRepairMaintenance } from '../src/maintenance/repair.js';
import { recoverInterruptedMaintenanceRuns } from '../src/maintenance/state.js';

async function main(): Promise<void> {
  const [startDate, endDate, ...rest] = process.argv.slice(2);
  if (!startDate || !endDate || rest.length > 0) {
    throw new Error('Usage: pnpm --filter api maintenance:repair YYYYMMDD YYYYMMDD');
  }
  assertProductionLock();
  const recovered = await recoverInterruptedMaintenanceRuns();
  if (recovered > 0) {
    console.warn(`[maintenance:repair] recovered ${recovered} interrupted run(s)`);
  }
  await runRepairMaintenance(startDate, endDate);
  console.log(`[maintenance:repair] complete ${startDate}..${endDate}`);
}

main()
  .catch((error: unknown) => {
    console.error(
      '[maintenance:repair] failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
