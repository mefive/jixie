import { prisma } from '../src/lib/prisma.js';
import { runDailySignalCycle } from '../src/signals/scheduler.js';

async function main(): Promise<void> {
  const tradeDate = process.argv[2];
  if (tradeDate && !/^\d{8}$/.test(tradeDate)) {
    throw new Error('trade date must be YYYYMMDD');
  }
  const summary = await runDailySignalCycle(tradeDate);
  console.table(summary);
  if (summary.errors > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
