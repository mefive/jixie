import { prisma } from '../src/lib/prisma.js';
import { syncMarketIndicators } from '../src/market/sync-market-indicators.js';

function currentDate(): string {
  return new Date().toISOString().slice(0, 10).replaceAll('-', '');
}

/**
 * Precompute daily whole-market, point-in-time index, and Shenwan level-1 state.
 * Usage: pnpm --filter api sync:market-state [start] [end]
 */
async function main(): Promise<void> {
  const [start = '20150101', end = currentDate()] = process.argv.slice(2);
  console.log(`Precomputing market state ${start} ~ ${end}\n`);

  await syncMarketIndicators(start, end);

  console.table({
    market_indicator: await prisma.marketIndicator.count(),
    index_indicator: await prisma.indexIndicator.count(),
    industry_indicator: await prisma.industryIndicator.count(),
  });
  console.log('Market-state precompute complete');
}

main()
  .catch((error: unknown) => {
    console.error(
      'Market-state precompute failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
