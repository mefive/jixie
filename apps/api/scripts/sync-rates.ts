import { loadTushareConfig } from '../src/config.js';
import { prisma } from '../src/lib/prisma.js';
import {
  MinistryOfFinanceCurveClient,
  syncChinaTreasuryYieldCurve,
} from '../src/rates/china-treasury-curve.js';
import { syncTradeCal } from '../src/store/sync.js';
import { TushareClient } from '../src/tushare/client.js';

function currentDate(): string {
  return new Date().toISOString().slice(0, 10).replaceAll('-', '');
}

function addCalendarDays(date: string, days: number): string {
  const value = new Date(
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(4, 6)) - 1,
      Number(date.slice(6, 8)) + days,
    ),
  );
  return value.toISOString().slice(0, 10).replaceAll('-', '');
}

/** Sync the official Ministry of Finance China government-bond yield curve. */
async function main(): Promise<void> {
  const [startDate = '20060301', endDate = currentDate()] = process.argv.slice(2);
  if (!/^\d{8}$/.test(startDate) || !/^\d{8}$/.test(endDate) || startDate > endDate) {
    throw new Error('start/end must be YYYYMMDD and start must not exceed end');
  }
  const config = loadTushareConfig();
  const tushare = new TushareClient({
    token: config.token,
    baseUrl: config.baseUrl,
    minIntervalMs: config.minIntervalMs,
  });
  await syncTradeCal(tushare, startDate, addCalendarDays(endDate, 14));
  const count = await syncChinaTreasuryYieldCurve(
    new MinistryOfFinanceCurveClient(),
    startDate,
    endDate,
  );
  console.log(`China treasury curve sync complete: ${count} points`);
}

main()
  .catch((error: unknown) => {
    console.error('Rate data sync failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
