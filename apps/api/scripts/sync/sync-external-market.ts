import { loadTushareConfig } from '#market/providers/tushare/config.js';
import { addDays } from '#date';
import { prisma } from '#infra/database/prisma.js';
import { syncExternalMarketDrivers } from '#market/rates/external-market-drivers.js';
import { syncTradeCal } from '#market/sync/calendar.js';
import { TushareClient } from '#market/providers/tushare/client.js';

const SHANGHAI_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

async function main(): Promise<void> {
  const [startDate = '20050101', endDate = shanghaiToday()] = process.argv.slice(2);
  if (!/^\d{8}$/.test(startDate) || !/^\d{8}$/.test(endDate) || startDate > endDate) {
    throw new Error('start/end must be YYYYMMDD and start must not exceed end');
  }
  const config = loadTushareConfig();
  const client = new TushareClient({
    token: config.token,
    baseUrl: config.baseUrl,
    minIntervalMs: config.minIntervalMs,
  });
  await syncTradeCal(client, startDate, addDays(endDate, 14));
  const summary = await syncExternalMarketDrivers(client, startDate, endDate);
  console.log(
    `External market sync complete: ${summary.nominalCurvePoints} nominal points, ${summary.realCurvePoints} real points, ${summary.fxBars} FX bars (${Object.entries(
      summary.fxBarsByCode,
    )
      .map(([code, rows]) => `${code}=${rows}`)
      .join(', ')})`,
  );
}

function shanghaiToday(): string {
  const parts = Object.fromEntries(
    SHANGHAI_DATE_FORMATTER.formatToParts(new Date()).map((part) => [part.type, part.value]),
  );
  return `${parts.year}${parts.month}${parts.day}`;
}

main()
  .catch((error: unknown) => {
    console.error(
      'External market sync failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
