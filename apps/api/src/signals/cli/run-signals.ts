import { prisma } from '#infra/database/prisma.js';
import { generateDailySignals } from '../daily/scheduler.js';
import { runStagedMaintenance } from '#maintenance/staging/coordinator.js';
import { latestCompletedTradeDate } from '#market/calendar/sse-close.js';

async function main(): Promise<void> {
  const tradeDate = process.argv[2];
  if (tradeDate && !/^\d{8}$/.test(tradeDate)) {
    throw new Error('trade date must be YYYYMMDD');
  }
  await runStagedMaintenance('daily', tradeDate ? [tradeDate] : []);
  const cutoff = tradeDate ?? (await latestCompletedTradeDate());
  if (!cutoff) {
    throw new Error('No completed trading date is available');
  }
  const summary = await generateDailySignals(cutoff);
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
