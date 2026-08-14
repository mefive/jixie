import { syncChinaMacroData } from '../src/macro/china-macro.js';
import { BlsPublicDataClient, syncUsHeadlineCpiData } from '../src/macro/us-headline-cpi.js';
import { loadTushareConfig } from '../src/config.js';
import { addDays } from '../src/lib/date.js';
import { prisma } from '../src/lib/prisma.js';
import { syncTradeCal } from '../src/store/sync.js';
import { TushareClient } from '../src/tushare/client.js';

const CHINA_MONTH_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
});

/** Sync normalized China and US macro series with PIT availability evidence. */
async function main(): Promise<void> {
  const [startMonth = '200501', endMonth = currentMonth()] = process.argv.slice(2);
  assertMonthRange(startMonth, endMonth);
  const config = loadTushareConfig();
  const client = new TushareClient({
    token: config.token,
    baseUrl: config.baseUrl,
    minIntervalMs: config.minIntervalMs,
  });
  await syncTradeCal(client, `${startMonth}01`, addDays(monthEnd(endMonth), 40));
  const chinaSummary = await syncChinaMacroData(client, startMonth, endMonth);
  const usCpiSummary = await syncUsHeadlineCpiData(new BlsPublicDataClient(), startMonth, endMonth);
  console.log(
    `Macro sync complete: ${chinaSummary.series + usCpiSummary.series} series, ${chinaSummary.insertedVintages + usCpiSummary.insertedVintages} inserted vintages`,
  );
}

function currentMonth(): string {
  const parts = Object.fromEntries(
    CHINA_MONTH_FORMATTER.formatToParts(new Date()).map((part) => [part.type, part.value]),
  );
  return `${parts.year}${parts.month}`;
}

function monthEnd(month: string): string {
  const value = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(4, 6)), 0));
  return value.toISOString().slice(0, 10).replaceAll('-', '');
}

function assertMonthRange(startMonth: string, endMonth: string): void {
  const valid = (month: string) =>
    /^\d{6}$/.test(month) && Number(month.slice(4, 6)) >= 1 && Number(month.slice(4, 6)) <= 12;
  if (!valid(startMonth) || !valid(endMonth) || startMonth > endMonth) {
    throw new Error('start/end must be YYYYMM and start must not exceed end');
  }
}

main()
  .catch((error: unknown) => {
    console.error(
      'Macro data sync failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
